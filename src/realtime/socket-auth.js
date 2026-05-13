const { prisma } = require("../lib/prisma");
const { verifyToken } = require("../utils/jwt");

const authenticateSocketToken = async (token) => {
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
    throw new Error("User not found for websocket token");
  }

  return {
    userId: user.id,
    vendorId: user.vendor?.id ?? null,
    role: user.role,
  };
};

module.exports = { authenticateSocketToken };
