const { Prisma } = require("@prisma/client");
const { prisma } = require("../lib/prisma");
const { USER_ROLES } = require("../constants/enums");
const { serialize } = require("../utils/serialize");
const { ApiError } = require("../utils/api-error");

const orderInclude = {
  restaurant: {
    select: {
      id: true,
      title: true,
      address: true,
      coverImage: true,
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

module.exports = { createOrder, getMyOrders, getMyOrderById, orderInclude };
