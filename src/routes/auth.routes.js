const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const {
  register,
  login,
  syncCustomerWithFirebase,
  me,
} = require("../controllers/auth.controller");
const { USER_ROLES } = require("../constants/enums");

const router = express.Router();

const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(100),
    role: z.literal(USER_ROLES.CUSTOMER),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(100),
  }),
});

const firebaseCustomerSyncSchema = z.object({
  body: z.object({
    idToken: z.string().min(1),
  }),
});

router.post("/register", validate(registerSchema), asyncHandler(register));
router.post("/login", validate(loginSchema), asyncHandler(login));
router.post(
  "/firebase/customer",
  validate(firebaseCustomerSyncSchema),
  asyncHandler(syncCustomerWithFirebase),
);
router.get("/me", requireAuth, asyncHandler(me));

module.exports = router;
