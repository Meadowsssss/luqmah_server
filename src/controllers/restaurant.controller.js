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
      ratings: true,
    },
  },
  ratings: {
    select: {
      score: true,
    },
  },
};

const ratingSummary = (ratings = []) => {
  if (!ratings.length) {
    return { averageRating: null, ratingCount: 0 };
  }

  const total = ratings.reduce((sum, rating) => sum + rating.score, 0);
  return {
    averageRating: Math.round((total / ratings.length) * 10) / 10,
    ratingCount: ratings.length,
  };
};

const withRatingSummary = (restaurant) => {
  const { ratings, ...rest } = restaurant;
  return {
    ...rest,
    ...ratingSummary(ratings),
  };
};

const getRestaurants = async (_req, res) => {
  const restaurants = await prisma.restaurant.findMany({
    where: { isActive: true },
    include: restaurantSummaryInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json({ restaurants: serialize(restaurants.map(withRatingSummary)) });
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

  res.json({ restaurant: serialize(withRatingSummary(restaurant)) });
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
      ratings: {
        select: {
          score: true,
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
      ...ratingSummary(restaurant.ratings),
    }),
    categories: serialize(restaurant.menuCategories),
  });
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  getRestaurantMenu,
};
