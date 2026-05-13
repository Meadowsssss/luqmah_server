const bcrypt = require("bcryptjs");
const { prisma } = require("../lib/prisma");
const { USER_ROLES } = require("../constants/enums");
const { ApiError } = require("../utils/api-error");

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (req.auth.role === USER_ROLES.CUSTOMER) {
    throw new ApiError(
      403,
      "Customers must change their password through Firebase.",
      { code: "CUSTOMER_FIREBASE_PASSWORD_CHANGE_REQUIRED" },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
  });

  if (!user?.passwordHash) {
    throw new ApiError(400, "Password login is not configured for this account.", {
      code: "PASSWORD_AUTH_NOT_CONFIGURED",
    });
  }

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!matches) {
    throw new ApiError(400, "Current password is incorrect", {
      code: "CURRENT_PASSWORD_INCORRECT",
    });
  }

  const samePassword = await bcrypt.compare(newPassword, user.passwordHash);

  if (samePassword) {
    throw new ApiError(400, "New password must be different from current password", {
      code: "PASSWORD_UNCHANGED",
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: req.auth.userId },
    data: { passwordHash },
  });

  res.json({ message: "Password updated successfully" });
};

module.exports = { changePassword };
