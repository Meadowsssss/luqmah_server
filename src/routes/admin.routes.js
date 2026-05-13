const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { USER_ROLES } = require("../constants/enums");
const {
  loginAdmin,
  getAdminMe,
  getVendors,
  createVendor,
  deleteVendor,
} = require("../controllers/admin.controller");

const router = express.Router();

const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(100),
  }),
});

const restaurantSchema = z.object({
  title: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).optional(),
  address: z.string().trim().max(250).optional(),
  coverImage: z.string().url().optional(),
  isActive: z.boolean().default(true),
});

const vendorCategorySchema = z.object({
  title: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).optional(),
});

const createVendorSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: z.string().min(8).max(100),
    restaurant: restaurantSchema,
    categories: z.array(vendorCategorySchema).min(1),
  }),
});

const vendorIdParamSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
});

router.post("/login", validate(adminLoginSchema), asyncHandler(loginAdmin));
router.get("/me", requireAuth, requireRole(USER_ROLES.ADMIN), asyncHandler(getAdminMe));
router.get("/vendors", requireAuth, requireRole(USER_ROLES.ADMIN), asyncHandler(getVendors));
router.post(
  "/vendors",
  requireAuth,
  requireRole(USER_ROLES.ADMIN),
  validate(createVendorSchema),
  asyncHandler(createVendor),
);
router.delete(
  "/vendors/:id",
  requireAuth,
  requireRole(USER_ROLES.ADMIN),
  validate(vendorIdParamSchema),
  asyncHandler(deleteVendor),
);

module.exports = router;
