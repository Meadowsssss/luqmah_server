const bcrypt = require("bcryptjs");
const { prisma } = require("../lib/prisma");
const { USER_ROLES } = require("../constants/enums");
const { ApiError } = require("../utils/api-error");
const {
  hasBlockedDisplayNameTerm,
  isLettersAndSpacesName,
  normalizeDisplayName,
} = require("../utils/profile-validation");

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

const updateCustomerPhoneNumber = async (req, res) => {
  if (req.auth.role !== USER_ROLES.CUSTOMER) {
    throw new ApiError(403, "Only customers can update a phone number.", {
      code: "CUSTOMER_ACCESS_REQUIRED",
    });
  }

  const phoneNumber = req.body.phoneNumber.trim();

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: { phoneNumber },
    select: { phoneNumber: true },
  });

  res.json({ phoneNumber: user.phoneNumber });
};

const toDisplayName = (value) =>
  normalizeDisplayName(value)
    .split(" ")
    .map((part) =>
      part.isEmpty ? part : part[0].toUpperCase() + part.slice(1),
    )
    .join(" ");

const updateCustomerName = async (req, res) => {
  if (req.auth.role !== USER_ROLES.CUSTOMER) {
    throw new ApiError(403, "Only customers can update their name.", {
      code: "CUSTOMER_ACCESS_REQUIRED",
    });
  }

  const name = req.body.name.trim();

  if (!isLettersAndSpacesName(name)) {
    throw new ApiError(400, "Use letters and spaces only.", {
      code: "INVALID_CUSTOMER_NAME_FORMAT",
    });
  }

  if (hasBlockedDisplayNameTerm(name)) {
    throw new ApiError(400, "Choose a different display name.", {
      code: "INAPPROPRIATE_CUSTOMER_NAME",
    });
  }

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: { name: toDisplayName(name) },
    select: { name: true },
  });

  res.json({ name: user.name });
};

const registerPushToken = async (req, res) => {
  const { token, platform } = req.body;

  const pushToken = await prisma.pushToken.upsert({
    where: { token },
    update: {
      userId: req.auth.userId,
      platform,
    },
    create: {
      userId: req.auth.userId,
      token,
      platform,
    },
  });

  res.status(201).json({ pushToken: { id: pushToken.id, token: pushToken.token, platform: pushToken.platform } });
};

const unregisterPushToken = async (req, res) => {
  const { token } = req.body;

  await prisma.pushToken.deleteMany({
    where: {
      userId: req.auth.userId,
      token,
    },
  });

  res.json({ message: "Push token removed." });
};

module.exports = {
  changePassword,
  updateCustomerName,
  updateCustomerPhoneNumber,
  registerPushToken,
  unregisterPushToken,
};
