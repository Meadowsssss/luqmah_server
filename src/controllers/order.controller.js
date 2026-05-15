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

const orderInclude = {
  restaurant: {
    select: {
      id: true,
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

  const menuItemIds = [...new Set(items.map((item) => item.menuItemId))];
  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: menuItemIds },
      restaurantId,
      isAvailable: true,
    },
    include: {
      customizations: true,
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

    const requestedCustomizationIds = [...new Set(item.customizationIds ?? [])];
    const customizationMap = new Map(
      menuItem.customizations.map((customization) => [customization.id, customization]),
    );

    const selectedCustomizations = requestedCustomizationIds.map((customizationId) => {
      const customization = customizationMap.get(customizationId);

      if (!customization) {
        throw new ApiError(
          400,
          `Customization ${customizationId} is not available for ${menuItem.title}`,
        );
      }

      return customization;
    });

    const unitPrice = new Prisma.Decimal(menuItem.price);
    const quantity = item.quantity;
    const customizationUnitTotal = selectedCustomizations.reduce(
      (sum, customization) => sum.plus(customization.priceDelta),
      new Prisma.Decimal(0),
    );
    const lineTotal = unitPrice
      .plus(customizationUnitTotal)
      .mul(new Prisma.Decimal(quantity));

    return {
      menuItemId: menuItem.id,
      itemTitle: menuItem.title,
      unitPrice,
      quantity,
      lineTotal,
      customizations: {
        create: selectedCustomizations.map((customization) => ({
          menuItemCustomizationId: customization.id,
          title: customization.title,
          priceDelta: customization.priceDelta,
        })),
      },
    };
  });

  const totalAmount = orderItemsData.reduce(
    (sum, item) => sum.plus(item.lineTotal),
    new Prisma.Decimal(0),
  );

  const order = await prisma.order.create({
    data: {
      customerId: req.auth.userId,
      restaurantId,
      notes,
      totalAmount,
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
  rateOrder,
  dismissOrderRatingPrompt,
  getLatestCompletedCustomerOrder,
  orderInclude,
};
