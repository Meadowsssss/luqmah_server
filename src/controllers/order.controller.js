let Prisma;
try {
  ({ Prisma } = require("@prisma/client"));
} catch (_error) {
  Prisma = { Decimal: Number };
}
const { prisma } = require("../lib/prisma");
const { USER_ROLES, ORDER_STATUSES } = require("../constants/enums");
const { serialize } = require("../utils/serialize");
const { ApiError } = require("../utils/api-error");
const { EVENT_TYPES, realtime } = require("../realtime/socket-events");
const { sendPushToVendor } = require("../lib/push-notifications");

const orderInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
    },
  },
  restaurant: {
    select: {
      id: true,
      vendorId: true,
      title: true,
      address: true,
      coverImage: true,
    },
  },
  rating: true,
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

const getLatestCompletedCustomerOrder = (customerId) => {
  return prisma.order.findFirst({
    where: {
      customerId,
      status: ORDER_STATUSES.COMPLETED,
    },
    orderBy: { updatedAt: "desc" },
    include: {
      rating: true,
    },
  });
};

const decimal = (value) =>
  typeof Prisma.Decimal === "function" ? new Prisma.Decimal(value) : Number(value);

const getRequestedOptionIds = (item) => [
  ...new Set([...(item.optionIds ?? []), ...(item.customizationIds ?? [])]),
];

const validateAndSelectOptions = (menuItem, item) => {
  const requestedOptionIds = getRequestedOptionIds(item);
  const optionMap = new Map();

  const optionGroups = menuItem.optionGroups ?? [];

  for (const group of optionGroups) {
    for (const option of group.options) {
      optionMap.set(option.id, { ...option, optionGroup: group });
    }
  }

  const selectionsByGroupId = new Map();
  const selectedOptions = requestedOptionIds.map((optionId) => {
    const option = optionMap.get(optionId);

    if (!option) {
      throw new ApiError(400, `Option ${optionId} is not available for ${menuItem.title}`);
    }

    const currentSelections = selectionsByGroupId.get(option.optionGroup.id) ?? [];
    currentSelections.push(option);
    selectionsByGroupId.set(option.optionGroup.id, currentSelections);
    return option;
  });

  for (const group of optionGroups) {
    const groupSelections = selectionsByGroupId.get(group.id) ?? [];

    if (group.isRequired && groupSelections.length === 0) {
      throw new ApiError(400, `${group.title} is required for ${menuItem.title}`);
    }

    if (group.selectionType === "SINGLE" && groupSelections.length > 1) {
      throw new ApiError(400, `Choose only one option for ${group.title}`);
    }
  }

  return selectedOptions;
};

const createOrder = async (req, res) => {
  if (req.auth.role !== USER_ROLES.CUSTOMER) {
    throw new ApiError(403, "Only customers can place orders");
  }

  const { restaurantId, items, notes } = req.body;

  const restaurant = await prisma.restaurant.findFirst({
    where: {
      id: restaurantId,
      isActive: true,
    },
  });

  if (!restaurant) {
    throw new ApiError(404, "Restaurant not found");
  }

  if (restaurant.isBusy) {
    throw new ApiError(
      409,
      "This restaurant is busy right now. You can browse the menu, but ordering is temporarily unavailable.",
    );
  }

  const blacklistEntry = prisma.vendorBlacklist?.findUnique
    ? await prisma.vendorBlacklist.findUnique({
        where: {
          vendorId_customerId: {
            vendorId: restaurant.vendorId,
            customerId: req.auth.userId,
          },
        },
        select: { id: true },
      })
    : null;

  if (blacklistEntry) {
    throw new ApiError(403, "You are no longer allowed to place orders with this vendor.", {
      code: "VENDOR_BLACKLISTED_CUSTOMER",
    });
  }

  const existingActiveOrder = await prisma.order.findFirst({
    where: {
      customerId: req.auth.userId,
      status: {
        in: [
          ORDER_STATUSES.ACCEPTED,
          ORDER_STATUSES.IN_PROGRESS,
          ORDER_STATUSES.READY,
        ],
      },
    },
    select: { id: true },
  });

  if (existingActiveOrder) {
    throw new ApiError(
      409,
      "You already have an order in progress. You can't place a new order until your current order is finished.",
      { code: "CUSTOMER_ACTIVE_ORDER_EXISTS" },
    );
  }

  const menuItemIds = [...new Set(items.map((item) => item.menuItemId))];
  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: menuItemIds },
      restaurantId,
      isAvailable: true,
    },
    include: {
      optionGroups: {
        include: {
          options: true,
        },
      },
    },
  });

  if (menuItems.length !== menuItemIds.length) {
    throw new ApiError(400, "One or more menu items are invalid or unavailable");
  }

  const menuItemMap = new Map(menuItems.map((item) => [item.id, item]));

  const orderItemsData = items.map((item) => {
    const menuItem = menuItemMap.get(item.menuItemId);

    if (!menuItem) {
      throw new ApiError(400, "Invalid menu item");
    }

    const selectedOptions = validateAndSelectOptions(menuItem, item);

    const unitPriceValue = Number(menuItem.price);
    const quantity = item.quantity;
    const customizationUnitTotal = selectedOptions.reduce(
      (sum, option) => sum + Number(option.priceDelta),
      0,
    );
    const lineTotalValue = (unitPriceValue + customizationUnitTotal) * quantity;

    return {
      menuItemId: menuItem.id,
      itemTitle: menuItem.title,
      unitPrice: decimal(unitPriceValue),
      quantity,
      lineTotal: decimal(lineTotalValue),
      customizations: {
        create: selectedOptions.map((option) => ({
          menuItemCustomizationId: option.id,
          title: option.optionGroup.selectionType === "SINGLE"
            ? `${option.optionGroup.title}: ${option.title}`
            : option.title,
          priceDelta: option.priceDelta,
        })),
      },
    };
  });

  const totalAmount = orderItemsData.reduce(
    (sum, item) => sum + Number(item.lineTotal),
    0,
  );

  const order = await prisma.order.create({
    data: {
      customerId: req.auth.userId,
      restaurantId,
      notes,
      totalAmount: decimal(totalAmount),
      orderItems: {
        create: orderItemsData,
      },
    },
    include: orderInclude,
  });

  if (restaurant.vendorId) {
    realtime.notifyVendor(restaurant.vendorId, {
      type: EVENT_TYPES.ORDER_CREATED,
      orderId: order.id,
      order: serialize(order),
      customerId: req.auth.userId,
      vendorId: restaurant.vendorId,
      restaurantId,
    });
    await sendPushToVendor({
      vendorId: restaurant.vendorId,
      title: "New order received",
      body: "A new order is waiting in your queue.",
      data: {
        target: "vendor_orders",
        orderId: order.id,
        eventType: EVENT_TYPES.ORDER_CREATED,
      },
    });
  }
  realtime.notifyUser(req.auth.userId, {
    type: EVENT_TYPES.ORDER_CREATED,
    orderId: order.id,
    order: serialize(order),
    customerId: req.auth.userId,
    vendorId: restaurant.vendorId,
    restaurantId,
  });

  res.status(201).json({
    order: serialize(order),
  });
};

const getMyOrders = async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.auth.userId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json({ orders: serialize(orders) });
};

const getMyOrderById = async (req, res) => {
  const order = await prisma.order.findFirst({
    where: {
      id: req.params.id,
      customerId: req.auth.userId,
    },
    include: orderInclude,
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  res.json({ order: serialize(order) });
};

const cancelMyOrder = async (req, res) => {
  const order = await prisma.order.findFirst({
    where: {
      id: req.params.id,
      customerId: req.auth.userId,
    },
    include: orderInclude,
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.status !== ORDER_STATUSES.ACCEPTED) {
    throw new ApiError(409, "This order can no longer be cancelled.", {
      code: "ORDER_CANCELLATION_NOT_ALLOWED",
    });
  }

  const cancelledOrder = await prisma.order.update({
    where: { id: order.id },
    data: { status: ORDER_STATUSES.CANCELLED },
    include: orderInclude,
  });

  realtime.notifyUser(req.auth.userId, {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: cancelledOrder.id,
    status: cancelledOrder.status,
    order: serialize(cancelledOrder),
    customerId: req.auth.userId,
    vendorId: cancelledOrder.restaurant?.vendorId,
    restaurantId: cancelledOrder.restaurantId,
  });
  if (cancelledOrder.restaurant?.vendorId) {
    realtime.notifyVendor(cancelledOrder.restaurant.vendorId, {
      type: EVENT_TYPES.ORDER_UPDATED,
      orderId: cancelledOrder.id,
      status: cancelledOrder.status,
      order: serialize(cancelledOrder),
      customerId: req.auth.userId,
      vendorId: cancelledOrder.restaurant.vendorId,
      restaurantId: cancelledOrder.restaurantId,
    });
  }

  res.json({ order: serialize(cancelledOrder) });
};

const rateOrder = async (req, res) => {
  const { score } = req.body;
  const order = await prisma.order.findFirst({
    where: {
      id: req.params.id,
      customerId: req.auth.userId,
    },
    include: {
      rating: true,
    },
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.status !== ORDER_STATUSES.COMPLETED) {
    throw new ApiError(400, "Only completed orders can be rated", {
      code: "ORDER_NOT_COMPLETED",
    });
  }

  if (!order.restaurantId) {
    throw new ApiError(400, "This order is no longer linked to a restaurant", {
      code: "ORDER_RESTAURANT_MISSING",
    });
  }

  if (order.rating) {
    throw new ApiError(409, "This order has already been rated", {
      code: "ORDER_ALREADY_RATED",
    });
  }

  const rating = await prisma.orderRating.create({
    data: {
      orderId: order.id,
      restaurantId: order.restaurantId,
      customerId: req.auth.userId,
      score,
    },
  });

  realtime.notifyUser(req.auth.userId, {
    type: EVENT_TYPES.RATING_CREATED,
    orderId: order.id,
    score,
    customerId: req.auth.userId,
    restaurantId: order.restaurantId,
  });
  realtime.notifyRole(USER_ROLES.CUSTOMER, {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId: order.restaurantId,
  });

  res.status(201).json({ rating: serialize(rating) });
};

const dismissOrderRatingPrompt = async (req, res) => {
  const latestCompletedOrder = await getLatestCompletedCustomerOrder(req.auth.userId);

  if (!latestCompletedOrder || latestCompletedOrder.id !== req.params.id) {
    throw new ApiError(400, "Only the latest completed order rating prompt can be dismissed", {
      code: "LATEST_COMPLETED_ORDER_REQUIRED",
    });
  }

  const order = await prisma.order.update({
    where: { id: latestCompletedOrder.id },
    data: { ratingPromptDismissedAt: new Date() },
    include: orderInclude,
  });

  realtime.notifyUser(req.auth.userId, {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: order.id,
    customerId: req.auth.userId,
    restaurantId: order.restaurantId,
  });

  res.json({ order: serialize(order) });
};

module.exports = {
  createOrder,
  getMyOrders,
  getMyOrderById,
  cancelMyOrder,
  rateOrder,
  dismissOrderRatingPrompt,
  getLatestCompletedCustomerOrder,
  orderInclude,
};
