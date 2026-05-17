const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { changePassword, updateCustomerPhoneNumber } = require("../controllers/user.controller");

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

router.patch(
  "/me/password",
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(changePassword),
);

router.patch(
  "/me/phone",
  requireAuth,
  validate(updatePhoneNumberSchema),
  asyncHandler(updateCustomerPhoneNumber),
);

module.exports = router;
