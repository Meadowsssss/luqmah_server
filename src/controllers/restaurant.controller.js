const { prisma } = require("../lib/prisma");
const { serialize } = require("../utils/serialize");
const { ApiError } = require("../utils/api-error");

const restaurantSummaryInclude = {
  vendor: {
    select: {
      id: true,
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  _count: {
    select: {
      menuCategories: true,
      menuItems: true,
    },
  },
};

const getRestaurants = async (_req, res) => {
  const restaurants = await prisma.restaurant.findMany({
    where: { isActive: true },
    include: restaurantSummaryInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json({ restaurants: serialize(restaurants) });
};

const getRestaurantById = async (req, res) => {
  const restaurant = await prisma.restaurant.findFirst({
    where: {
      id: req.params.id,
      isActive: true,
    },
    include: restaurantSummaryInclude,
  });

  if (!restaurant) {
    throw new ApiError(404, "Restaurant not found");
  }

  res.json({ restaurant: serialize(restaurant) });
};

const getRestaurantMenu = async (req, res) => {
  const restaurant = await prisma.restaurant.findFirst({
    where: {
      id: req.params.id,
      isActive: true,
    },
    include: {
      menuCategories: {
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        include: {
          menuItems: {
            where: { isAvailable: true },
            orderBy: { title: "asc" },
            include: {
              ingredients: {
                orderBy: { createdAt: "asc" },
              },
              customizations: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!restaurant) {
    throw new ApiError(404, "Restaurant not found");
  }

  res.json({
    restaurant: serialize({
      id: restaurant.id,
      title: restaurant.title,
      description: restaurant.description,
      address: restaurant.address,
      coverImage: restaurant.coverImage,
      isBusy: restaurant.isBusy,
    }),
    categories: serialize(restaurant.menuCategories),
  });
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  getRestaurantMenu,
};
