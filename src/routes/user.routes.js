const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const {
  changePassword,
  updateCustomerName,
  updateCustomerPhoneNumber,
  registerPushToken,
  unregisterPushToken,
} = require("../controllers/user.controller");

const router = express.Router();

const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(8).max(100),
      newPassword: z.string().min(8).max(100),
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: "New password must be different from current password",
      path: ["newPassword"],
    }),
});

const updatePhoneNumberSchema = z.object({
  body: z.object({
    phoneNumber: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .max(30, "Phone number is too long")
      .regex(/^[0-9+\- ]+$/, "Use digits, spaces, +, or - only"),
  }),
});

const updateNameSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(80, "Use between 2 and 80 characters.")
      .regex(/^[A-Za-z\u0621-\u064A\s]+$/u, "Use letters and spaces only"),
  }),
});

const pushTokenSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    platform: z.enum(["android"]),
  }),
});

router.patch(
  "/me/password",
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(changePassword),
);

router.patch(
  "/me/name",
  requireAuth,
  validate(updateNameSchema),
  asyncHandler(updateCustomerName),
);

router.patch(
  "/me/phone",
  requireAuth,
  validate(updatePhoneNumberSchema),
  asyncHandler(updateCustomerPhoneNumber),
);
router.post(
  "/me/push-tokens",
  requireAuth,
  validate(pushTokenSchema),
  asyncHandler(registerPushToken),
);
router.delete(
  "/me/push-tokens",
  requireAuth,
  validate(pushTokenSchema),
  asyncHandler(unregisterPushToken),
);

module.exports = router;
