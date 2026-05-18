const { prisma } = require("../lib/prisma");
const { USER_ROLES, ORDER_STATUSES, VENDOR_ORDER_FILTERS } = require("../constants/enums");
const { canTransitionOrderStatus } = require("../utils/order-status");
const {
  DEFAULT_PREP_MINUTES,
  estimateReadyAt,
  historicalPrepMinutesFromOrders,
} = require("../utils/order-estimate");
const { sendPushToUser } = require("../lib/push-notifications");
const { serialize } = require("../utils/serialize");
const { ApiError } = require("../utils/api-error");
const { EVENT_TYPES, realtime } = require("../realtime/socket-events");

const vendorOrderInclude = {
  restaurant: {
    select: {
      id: true,
      title: true,
      address: true,
    },
  },
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
    },
  },
  orderItems: {
    include: {
      customizations: true,
      menuItem: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  },
};

const vendorMenuItemInclude = {
  restaurant: {
    select: {
      id: true,
      title: true,
    },
  },
  category: {
    select: {
      id: true,
      title: true,
    },
  },
  ingredients: true,
  optionGroups: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      options: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  },
};

const vendorBlacklistInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
    },
  },
};

const activeBlacklistStatuses = [
  ORDER_STATUSES.ACCEPTED,
  ORDER_STATUSES.IN_PROGRESS,
  ORDER_STATUSES.READY,
];

const normalizeOptionGroups = (body = {}) => {
  if (Array.isArray(body.optionGroups)) {
    return body.optionGroups.map((group, groupIndex) => ({
      title: group.title.trim(),
      selectionType: group.selectionType === "single" ? "SINGLE" : "MULTIPLE",
      isRequired: Boolean(group.isRequired),
      sortOrder: group.sortOrder ?? groupIndex,
      options: (group.options ?? []).map((option, optionIndex) => ({
        title: option.title.trim(),
        priceDelta: option.priceDelta,
        sortOrder: option.sortOrder ?? optionIndex,
      })),
    }));
  }

  if (Array.isArray(body.customizations) && body.customizations.length > 0) {
    return [
      {
        title: "Options",
        selectionType: "MULTIPLE",
        isRequired: false,
        sortOrder: 0,
        options: body.customizations.map((option, optionIndex) => ({
          title: option.title.trim(),
          priceDelta: option.priceDelta,
          sortOrder: option.sortOrder ?? optionIndex,
        })),
      },
    ];
  }

  return [];
};

const ensureVendorRestaurant = async (vendorId, restaurantId) => {
  const restaurant = await prisma.restaurant.findFirst({
    where: {
      id: restaurantId,
      vendorId,
    },
  });

  if (!restaurant) {
    throw new ApiError(404, "Restaurant not found for this vendor");
  }

  return restaurant;
};

const getVendorRestaurants = async (req, res) => {
  const restaurants = await prisma.restaurant.findMany({
    where: {
      vendorId: req.auth.vendorId,
    },
    include: {
      menuCategories: {
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
      _count: {
        select: {
          menuItems: true,
          orders: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ restaurants: serialize(restaurants) });
};

const getVendorBlacklist = async (req, res) => {
  const entries = await prisma.vendorBlacklist.findMany({
    where: { vendorId: req.auth.vendorId },
    include: vendorBlacklistInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json({ entries: serialize(entries) });
};

const createVendorBlacklistEntry = async (req, res) => {
  const customer = await prisma.user.findUnique({
    where: { id: req.body.customerId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!customer || customer.role !== USER_ROLES.CUSTOMER) {
    throw new ApiError(404, "Customer not found");
  }

  const existingEntry = await prisma.vendorBlacklist.findUnique({
    where: {
      vendorId_customerId: {
        vendorId: req.auth.vendorId,
        customerId: customer.id,
      },
    },
  });

  if (existingEntry) {
    throw new ApiError(409, "This student is already blacklisted", {
      code: "CUSTOMER_ALREADY_BLACKLISTED",
    });
  }

  const reason = req.body.reason?.trim() || null;
  const entry = await prisma.vendorBlacklist.create({
    data: {
      vendorId: req.auth.vendorId,
      customerId: customer.id,
      reason,
      createdByUserId: req.auth.userId,
    },
    include: vendorBlacklistInclude,
  });

  const activeOrders = await prisma.order.findMany({
    where: {
      customerId: customer.id,
      status: {
        in: activeBlacklistStatuses,
      },
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
    select: { id: true },
  });

  const cancelledOrders = await Promise.all(
    activeOrders.map((order) =>
      prisma.order.update({
        where: { id: order.id },
        data: { status: ORDER_STATUSES.CANCELLED },
        include: vendorOrderInclude,
      }),
    ),
  );

  await Promise.all(
    cancelledOrders.map(async (order) => {
      const serializedOrder = serialize(order);

      realtime.notifyUser(order.customerId, {
        type: EVENT_TYPES.ORDER_UPDATED,
        orderId: order.id,
        status: order.status,
        order: serializedOrder,
        customerId: order.customerId,
        vendorId: req.auth.vendorId,
        restaurantId: order.restaurantId,
      });
      realtime.notifyVendor(req.auth.vendorId, {
        type: EVENT_TYPES.ORDER_UPDATED,
        orderId: order.id,
        status: order.status,
        order: serializedOrder,
        customerId: order.customerId,
        vendorId: req.auth.vendorId,
        restaurantId: order.restaurantId,
      });

      await sendPushToUser({
        userId: order.customerId,
        title: "Your order was cancelled",
        body: "This vendor can no longer accept your orders.",
        data: {
          target: "customer_orders",
          orderId: order.id,
          eventType: EVENT_TYPES.ORDER_UPDATED,
          status: ORDER_STATUSES.CANCELLED,
        },
      });
    }),
  );

  res.status(201).json({
    entry: serialize(entry),
    cancelledOrders: serialize(cancelledOrders),
  });
};

const deleteVendorBlacklistEntry = async (req, res) => {
  const entry = await prisma.vendorBlacklist.findUnique({
    where: {
      vendorId_customerId: {
        vendorId: req.auth.vendorId,
        customerId: req.params.customerId,
      },
    },
  });

  if (!entry) {
    throw new ApiError(404, "Blacklist entry not found");
  }

  await prisma.vendorBlacklist.delete({
    where: {
      vendorId_customerId: {
        vendorId: req.auth.vendorId,
        customerId: req.params.customerId,
      },
    },
  });

  res.json({ removedCustomerId: req.params.customerId });
};

const updateVendorRestaurant = async (req, res) => {
  const restaurant = await ensureVendorRestaurant(req.auth.vendorId, req.params.id);
  const { title, description, address, coverImage } = req.body;

  const updatedRestaurant = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(address !== undefined ? { address: address?.trim() || null } : {}),
      ...(coverImage !== undefined ? { coverImage: coverImage || null } : {}),
    },
    include: {
      menuCategories: {
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
      _count: {
        select: {
          menuItems: true,
          orders: true,
        },
      },
    },
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId: updatedRestaurant.id,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId: updatedRestaurant.id,
  });

  res.json({ restaurant: serialize(updatedRestaurant) });
};

const updateVendorRestaurantBusyState = async (req, res) => {
  const { restaurantId, isBusy } = req.body;

  await ensureVendorRestaurant(req.auth.vendorId, restaurantId);

  const restaurant = await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { isBusy },
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId,
    vendorId: req.auth.vendorId,
    isBusy,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId,
    isBusy,
  });

  res.json({ restaurant: serialize(restaurant) });
};

const createVendorRestaurantCategory = async (req, res) => {
  const { restaurantId, title } = req.body;

  await ensureVendorRestaurant(req.auth.vendorId, restaurantId);

  const normalizedTitle = title.trim();
  const existingCategory = await prisma.menuCategory.findFirst({
    where: {
      restaurantId,
      title: {
        equals: normalizedTitle,
        mode: "insensitive",
      },
    },
  });

  if (existingCategory) {
    throw new ApiError(409, "A category with this name already exists for the selected restaurant");
  }

  const sortOrder = await prisma.menuCategory.count({
    where: { restaurantId },
  });

  const category = await prisma.menuCategory.create({
    data: {
      restaurantId,
      title: normalizedTitle,
      sortOrder,
    },
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "category_created",
    restaurantId,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "category_created",
    restaurantId,
  });

  res.status(201).json({ category: serialize(category) });
};

const getVendorOrders = async (req, res) => {
  const filter = req.query.status || "new";
  const statuses = VENDOR_ORDER_FILTERS[filter];

  const orders = await prisma.order.findMany({
    where: {
      restaurant: {
        vendorId: req.auth.vendorId,
      },
      status: {
        in: statuses,
      },
    },
    include: vendorOrderInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json({
    filter,
    orders: serialize(orders),
  });
};

const getVendorOrderById = async (req, res) => {
  const order = await prisma.order.findFirst({
    where: {
      id: req.params.id,
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
    include: vendorOrderInclude,
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  res.json({ order: serialize(order) });
};

const updateVendorOrderStatus = async (req, res) => {
  const { status } = req.body;
  const order = await prisma.order.findFirst({
    where: {
      id: req.params.id,
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (!canTransitionOrderStatus(order.status, status)) {
    throw new ApiError(
      400,
      `Invalid order status transition from ${order.status} to ${status}`,
    );
  }

  const nextUpdateData = { status };
  if (status === ORDER_STATUSES.IN_PROGRESS && !order.inProgressStartedAt) {
    const historicalOrders = await prisma.order.findMany({
      where: {
        restaurantId: order.restaurantId,
        id: { not: order.id },
        status: {
          in: [ORDER_STATUSES.READY, ORDER_STATUSES.COMPLETED],
        },
        inProgressStartedAt: { not: null },
        readyAt: { not: null },
      },
      orderBy: { readyAt: "desc" },
      take: 20,
      select: {
        inProgressStartedAt: true,
        readyAt: true,
      },
    });

    const startedAt = new Date();
    const prepMinutes = historicalOrders.length
      ? historicalPrepMinutesFromOrders(historicalOrders)
      : DEFAULT_PREP_MINUTES;

    nextUpdateData.inProgressStartedAt = startedAt;
    nextUpdateData.estimatedReadyAt = estimateReadyAt(startedAt, prepMinutes);
  }

  if (status === ORDER_STATUSES.READY && !order.readyAt) {
    nextUpdateData.readyAt = new Date();
  }

  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: nextUpdateData,
    include: vendorOrderInclude,
  });

  realtime.notifyUser(updatedOrder.customerId, {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: updatedOrder.id,
    status: updatedOrder.status,
    order: serialize(updatedOrder),
    customerId: updatedOrder.customerId,
    vendorId: req.auth.vendorId,
    restaurantId: updatedOrder.restaurantId,
  });
  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: updatedOrder.id,
    status: updatedOrder.status,
    order: serialize(updatedOrder),
    customerId: updatedOrder.customerId,
    vendorId: req.auth.vendorId,
    restaurantId: updatedOrder.restaurantId,
  });

  if (status === ORDER_STATUSES.IN_PROGRESS) {
    await sendPushToUser({
      userId: updatedOrder.customerId,
      title: "Your order is being prepared",
      body: "The restaurant has started preparing your order.",
      data: {
        target: "customer_orders",
        orderId: updatedOrder.id,
        eventType: EVENT_TYPES.ORDER_UPDATED,
        status: ORDER_STATUSES.IN_PROGRESS,
      },
    });
  }

  if (status === ORDER_STATUSES.READY) {
    await sendPushToUser({
      userId: updatedOrder.customerId,
      title: "Your order is ready",
      body: "Your order is ready now.",
      data: {
        target: "customer_orders",
        orderId: updatedOrder.id,
        eventType: EVENT_TYPES.ORDER_UPDATED,
        status: ORDER_STATUSES.READY,
      },
    });
  }

  res.json({ order: serialize(updatedOrder) });
};

const getVendorMenuItems = async (req, res) => {
  const menuItems = await prisma.menuItem.findMany({
    where: {
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
    include: vendorMenuItemInclude,
    orderBy: [{ restaurant: { title: "asc" } }, { title: "asc" }],
  });

  res.json({ menuItems: serialize(menuItems) });
};

const createVendorMenuItem = async (req, res) => {
  const {
    restaurantId,
    categoryId,
    title,
    description,
    price,
    imageUrl,
    isAvailable,
    ingredientNames,
  } = req.body;
  const optionGroups = normalizeOptionGroups(req.body);

  await ensureVendorRestaurant(req.auth.vendorId, restaurantId);

  const category = await prisma.menuCategory.findFirst({
    where: {
      id: categoryId,
      restaurantId,
    },
  });

  if (!category) {
    throw new ApiError(404, "Menu category not found for this restaurant");
  }

  const menuItem = await prisma.$transaction(async (tx) => {
    const createdMenuItem = await tx.menuItem.create({
      data: {
        restaurantId,
        categoryId,
        title,
        description,
        price,
        imageUrl,
        isAvailable,
        ingredients: {
          create: (ingredientNames ?? []).map((name) => ({ name })),
        },
      },
    });

    if (optionGroups.length) {
      await tx.menuItemOptionGroup.createMany({
        data: optionGroups.map((group) => ({
          menuItemId: createdMenuItem.id,
          title: group.title,
          selectionType: group.selectionType,
          isRequired: group.isRequired,
          sortOrder: group.sortOrder,
        })),
      });

      const createdGroups = await tx.menuItemOptionGroup.findMany({
        where: { menuItemId: createdMenuItem.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });

      await tx.menuItemCustomization.createMany({
        data: createdGroups.flatMap((groupRecord, groupIndex) =>
          optionGroups[groupIndex].options.map((option) => ({
            menuItemId: createdMenuItem.id,
            optionGroupId: groupRecord.id,
            title: option.title,
            priceDelta: option.priceDelta,
            sortOrder: option.sortOrder,
          })),
        ),
      });
    }

    return tx.menuItem.findUnique({
      where: { id: createdMenuItem.id },
      include: vendorMenuItemInclude,
    });
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "created",
    menuItemId: menuItem.id,
    menuItem: serialize(menuItem),
    restaurantId,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "created",
    menuItemId: menuItem.id,
    restaurantId,
  });

  res.status(201).json({ menuItem: serialize(menuItem) });
};

const updateVendorMenuItem = async (req, res) => {
  const existingMenuItem = await prisma.menuItem.findFirst({
    where: {
      id: req.params.id,
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
  });

  if (!existingMenuItem) {
    throw new ApiError(404, "Menu item not found");
  }

  if (
    req.body.restaurantId &&
    req.body.restaurantId !== existingMenuItem.restaurantId
  ) {
    throw new ApiError(400, "Menu items must stay in their current restaurant", {
      code: "MENU_ITEM_RESTAURANT_LOCKED",
    });
  }

  const nextRestaurantId = existingMenuItem.restaurantId;
  await ensureVendorRestaurant(req.auth.vendorId, nextRestaurantId);
  const nextCategoryId = req.body.categoryId ?? existingMenuItem.categoryId;
  const optionGroups = normalizeOptionGroups(req.body);

  const category = await prisma.menuCategory.findFirst({
    where: {
      id: nextCategoryId,
      restaurantId: nextRestaurantId,
    },
  });

  if (!category) {
    throw new ApiError(404, "Menu category not found for this restaurant");
  }

  const menuItem = await prisma.$transaction(async (tx) => {
    const updated = await tx.menuItem.update({
      where: { id: existingMenuItem.id },
      data: {
        restaurantId: nextRestaurantId,
        categoryId: nextCategoryId,
        title: req.body.title,
        description: req.body.description,
        price: req.body.price,
        imageUrl: req.body.imageUrl,
        isAvailable: req.body.isAvailable,
      },
    });

    if (req.body.ingredientNames) {
      await tx.menuItemIngredient.deleteMany({
        where: { menuItemId: existingMenuItem.id },
      });

      if (req.body.ingredientNames.length) {
        await tx.menuItemIngredient.createMany({
          data: req.body.ingredientNames.map((name) => ({
            menuItemId: existingMenuItem.id,
            name,
          })),
        });
      }
    }

    if (req.body.optionGroups || req.body.customizations) {
      await tx.menuItemOptionGroup.deleteMany({
        where: { menuItemId: existingMenuItem.id },
      });

      if (optionGroups.length) {
        await tx.menuItemOptionGroup.createMany({
          data: optionGroups.map((group) => ({
            menuItemId: existingMenuItem.id,
            title: group.title,
            selectionType: group.selectionType,
            isRequired: group.isRequired,
            sortOrder: group.sortOrder,
          })),
        });

        const createdGroups = await tx.menuItemOptionGroup.findMany({
          where: { menuItemId: existingMenuItem.id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });

        await tx.menuItemCustomization.createMany({
          data: createdGroups.flatMap((groupRecord, groupIndex) =>
            optionGroups[groupIndex].options.map((option) => ({
              menuItemId: existingMenuItem.id,
              optionGroupId: groupRecord.id,
              title: option.title,
              priceDelta: option.priceDelta,
              sortOrder: option.sortOrder,
            })),
          ),
        });
      }
    }

    return updated;
  });

  const hydratedMenuItem = await prisma.menuItem.findUnique({
    where: { id: menuItem.id },
    include: vendorMenuItemInclude,
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "updated",
    menuItemId: hydratedMenuItem.id,
    menuItem: serialize(hydratedMenuItem),
    restaurantId: hydratedMenuItem.restaurant.id,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "updated",
    menuItemId: hydratedMenuItem.id,
    restaurantId: hydratedMenuItem.restaurant.id,
  });

  res.json({ menuItem: serialize(hydratedMenuItem) });
};

const updateVendorMenuItemAvailability = async (req, res) => {
  const menuItem = await prisma.menuItem.findFirst({
    where: {
      id: req.params.id,
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
  });

  if (!menuItem) {
    throw new ApiError(404, "Menu item not found");
  }

  const updatedMenuItem = await prisma.menuItem.update({
    where: { id: menuItem.id },
    data: {
      isAvailable: req.body.isAvailable,
    },
    include: vendorMenuItemInclude,
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "availability_changed",
    menuItemId: updatedMenuItem.id,
    menuItem: serialize(updatedMenuItem),
    restaurantId: updatedMenuItem.restaurant.id,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "availability_changed",
    menuItemId: updatedMenuItem.id,
    restaurantId: updatedMenuItem.restaurant.id,
  });

  res.json({ menuItem: serialize(updatedMenuItem) });
};

const deleteVendorMenuItem = async (req, res) => {
  const menuItem = await prisma.menuItem.findFirst({
    where: {
      id: req.params.id,
      restaurant: {
        vendorId: req.auth.vendorId,
      },
    },
    include: {
      restaurant: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!menuItem) {
    throw new ApiError(404, "Menu item not found");
  }

  await prisma.menuItem.delete({
    where: { id: menuItem.id },
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "deleted",
    menuItemId: menuItem.id,
    restaurantId: menuItem.restaurant.id,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
    action: "deleted",
    menuItemId: menuItem.id,
    restaurantId: menuItem.restaurant.id,
  });

  res.json({ deletedItemId: menuItem.id });
};

module.exports = {
  getVendorRestaurants,
  updateVendorRestaurant,
  updateVendorRestaurantBusyState,
  getVendorBlacklist,
  createVendorBlacklistEntry,
  deleteVendorBlacklistEntry,
  createVendorRestaurantCategory,
  getVendorOrders,
  getVendorOrderById,
  updateVendorOrderStatus,
  getVendorMenuItems,
  createVendorMenuItem,
  updateVendorMenuItem,
  updateVendorMenuItemAvailability,
  deleteVendorMenuItem,
};
