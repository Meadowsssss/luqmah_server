const { prisma } = require("../lib/prisma");
const { USER_ROLES } = require("../constants/enums");
const { verifyToken } = require("../utils/jwt");
const { ApiError } = require("../utils/api-error");

const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new ApiError(401, "Authorization token is required");
    }

    const token = header.slice(7);
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        vendor: {
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new ApiError(401, "User not found for this token");
    }

    req.auth = {
      userId: user.id,
      role: user.role,
      vendorId: user.vendor?.id ?? null,
      user,
    };

    next();
  } catch (error) {
    next(error);
  }
};

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.auth) {
    return next(new ApiError(401, "Authentication is required"));
  }

  if (!roles.includes(req.auth.role)) {
    return next(new ApiError(403, "You do not have access to this resource"));
  }

  if (roles.includes(USER_ROLES.VENDOR) && !req.auth.vendorId) {
    return next(new ApiError(403, "Vendor profile is required"));
  }

  next();
};

module.exports = { requireAuth, requireRole };
