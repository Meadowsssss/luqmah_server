const { prisma } = require("../lib/prisma");
const { USER_ROLES, ORDER_STATUSES, VENDOR_ORDER_FILTERS } = require("../constants/enums");
const { canTransitionOrderStatus } = require("../utils/order-status");
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
  customizations: true,
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
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId,
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
    restaurantId,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
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

  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: { status },
    include: vendorOrderInclude,
  });

  realtime.notifyUser(updatedOrder.customerId, {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: updatedOrder.id,
    customerId: updatedOrder.customerId,
    vendorId: req.auth.vendorId,
    restaurantId: updatedOrder.restaurantId,
  });
  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: updatedOrder.id,
    customerId: updatedOrder.customerId,
    vendorId: req.auth.vendorId,
    restaurantId: updatedOrder.restaurantId,
  });

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
    customizations,
  } = req.body;

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

  const menuItem = await prisma.menuItem.create({
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
      customizations: {
        create: (customizations ?? []).map((customization) => ({
          title: customization.title,
          priceDelta: customization.priceDelta,
        })),
      },
    },
    include: vendorMenuItemInclude,
  });

  realtime.notifyVendor(req.auth.vendorId, {
    type: EVENT_TYPES.MENU_UPDATED,
    restaurantId,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
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

  const nextRestaurantId = req.body.restaurantId ?? existingMenuItem.restaurantId;
  await ensureVendorRestaurant(req.auth.vendorId, nextRestaurantId);
  const nextCategoryId = req.body.categoryId ?? existingMenuItem.categoryId;

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
        restaurantId: req.body.restaurantId,
        categoryId: req.body.categoryId,
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

    if (req.body.customizations) {
      await tx.menuItemCustomization.deleteMany({
        where: { menuItemId: existingMenuItem.id },
      });

      if (req.body.customizations.length) {
        await tx.menuItemCustomization.createMany({
          data: req.body.customizations.map((customization) => ({
            menuItemId: existingMenuItem.id,
            title: customization.title,
            priceDelta: customization.priceDelta,
          })),
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
    restaurantId: hydratedMenuItem.restaurant.id,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
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
    restaurantId: updatedMenuItem.restaurant.id,
    vendorId: req.auth.vendorId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.MENU_UPDATED,
    restaurantId: updatedMenuItem.restaurant.id,
  });

  res.json({ menuItem: serialize(updatedMenuItem) });
};

module.exports = {
  getVendorRestaurants,
  updateVendorRestaurantBusyState,
  createVendorRestaurantCategory,
  getVendorOrders,
  getVendorOrderById,
  updateVendorOrderStatus,
  getVendorMenuItems,
  createVendorMenuItem,
  updateVendorMenuItem,
  updateVendorMenuItemAvailability,
};
