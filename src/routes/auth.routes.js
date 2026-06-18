const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const {
  isLettersAndSpacesName,
} = require("../utils/profile-validation");
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
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[A-Za-z\u0621-\u064A\s]+$/u, "Use letters and spaces only")
      .optional(),
    phoneNumber: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .max(30, "Phone number is too long")
      .regex(/^[0-9+\- ]+$/, "Use digits, spaces, +, or - only")
      .optional(),
  }).superRefine((data, ctx) => {
    if (data.name && !isLettersAndSpacesName(data.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Use letters and spaces only",
      });
    }
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
