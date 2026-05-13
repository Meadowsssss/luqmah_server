const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { changePassword } = require("../controllers/user.controller");

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

router.patch(
  "/me/password",
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(changePassword),
);

module.exports = router;
