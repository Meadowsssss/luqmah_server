const bcrypt = require("bcryptjs");
const { prisma } = require("../lib/prisma");
const { USER_ROLES, ORDER_STATUSES } = require("../constants/enums");
const { signToken } = require("../utils/jwt");
const { serialize } = require("../utils/serialize");
const { ApiError } = require("../utils/api-error");

const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

const adminVendorInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  restaurants: {
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
  },
};

const loginAdmin = async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      ...adminUserSelect,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (user.role !== USER_ROLES.ADMIN) {
    throw new ApiError(403, "Admin access is required");
  }

  const token = signToken(user);

  res.json({
    token,
    user: serialize({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }),
  });
};

const getAdminMe = async (req, res) => {
  res.json({
    user: serialize({
      id: req.auth.user.id,
      name: req.auth.user.name,
      email: req.auth.user.email,
      role: req.auth.user.role,
      createdAt: req.auth.user.createdAt,
      updatedAt: req.auth.user.updatedAt,
    }),
  });
};

const getVendors = async (_req, res) => {
  const vendors = await prisma.vendor.findMany({
    include: adminVendorInclude,
    orderBy: { createdAt: "desc" },
  });

  res.json({ vendors: serialize(vendors) });
};

const deleteVendor = async (req, res) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params.id },
    include: {
      restaurants: {
        select: { id: true },
      },
    },
  });

  if (!vendor) {
    throw new ApiError(404, "Vendor not found");
  }

  const restaurantIds = vendor.restaurants.map((restaurant) => restaurant.id);
  if (restaurantIds.length > 0) {
    const existingActiveOrder = await prisma.order.findFirst({
      where: {
        restaurantId: {
          in: restaurantIds,
        },
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
        "This vendor cannot be deleted because it still has active orders.",
      );
    }
  }

  await prisma.user.delete({
    where: { id: vendor.userId },
  });

  res.json({ message: "Vendor deleted successfully." });
};

const createVendor = async (req, res) => {
  const {
    name,
    email,
    password,
    restaurant: restaurantInput,
    categories,
  } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ApiError(409, "Email is already in use");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const vendor = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: USER_ROLES.VENDOR,
      },
    });

    const createdVendor = await tx.vendor.create({
      data: {
        userId: createdUser.id,
        restaurants: {
          create: {
            title: restaurantInput.title,
            description: restaurantInput.description,
            address: restaurantInput.address,
            coverImage: restaurantInput.coverImage,
            isActive: restaurantInput.isActive,
            menuCategories: {
              create: categories.map((category, index) => ({
                title: category.title,
                sortOrder: category.sortOrder ?? index,
              })),
            },
          },
        },
      },
      include: adminVendorInclude,
    });

    return createdVendor;
  });

  res.status(201).json({ vendor: serialize(vendor) });
};

module.exports = {
  loginAdmin,
  getAdminMe,
  getVendors,
  createVendor,
  deleteVendor,
};
