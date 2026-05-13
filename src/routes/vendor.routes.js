const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { USER_ROLES, ORDER_STATUSES } = require("../constants/enums");
const {
  getVendorRestaurants,
  updateVendorRestaurantBusyState,
  createVendorRestaurantCategory,
  getVendorOrders,
  getVendorOrderById,
  updateVendorOrderStatus,
  getVendorMenuItems,
  createVendorMenuItem,
  updateVendorMenuItem,
  updateVendorMenuItemAvailability,
} = require("../controllers/vendor.controller");

const router = express.Router();

const cuidParamSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
});

const vendorOrderQuerySchema = z.object({
  query: z.object({
    status: z.enum(["new", "past"]).default("new"),
  }),
});

const moneySchema = z.coerce.number().nonnegative().max(999999);

const customizationInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  priceDelta: moneySchema,
});

const menuItemCreateSchema = z.object({
  body: z.object({
    restaurantId: z.string().cuid(),
    categoryId: z.string().cuid(),
    title: z.string().trim().min(2).max(150),
    description: z.string().trim().max(500).optional(),
    price: moneySchema,
    imageUrl: z.string().url().optional(),
    isAvailable: z.boolean().default(true),
    ingredientNames: z.array(z.string().trim().min(1).max(120)).optional(),
    customizations: z.array(customizationInputSchema).optional(),
  }),
});

const menuCategoryCreateSchema = z.object({
  body: z.object({
    restaurantId: z.string().cuid(),
    title: z.string().trim().min(2).max(80),
  }),
});

const restaurantBusyUpdateSchema = z.object({
  body: z.object({
    restaurantId: z.string().cuid(),
    isBusy: z.boolean(),
  }),
});

const menuItemUpdateSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
  body: z
    .object({
      restaurantId: z.string().cuid().optional(),
      categoryId: z.string().cuid().optional(),
      title: z.string().trim().min(2).max(150).optional(),
      description: z.string().trim().max(500).nullable().optional(),
      price: moneySchema.optional(),
      imageUrl: z.string().url().nullable().optional(),
      isAvailable: z.boolean().optional(),
      ingredientNames: z.array(z.string().trim().min(1).max(120)).optional(),
      customizations: z.array(customizationInputSchema).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});

const menuItemAvailabilitySchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
  body: z.object({
    isAvailable: z.boolean(),
  }),
});

const vendorOrderStatusUpdateSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
  body: z.object({
    status: z.nativeEnum(ORDER_STATUSES),
  }),
});

router.use(requireAuth, requireRole(USER_ROLES.VENDOR));

router.get("/restaurants/me", asyncHandler(getVendorRestaurants));
router.patch(
  "/restaurants/busy",
  validate(restaurantBusyUpdateSchema),
  asyncHandler(updateVendorRestaurantBusyState),
);
router.post(
  "/menu-categories",
  validate(menuCategoryCreateSchema),
  asyncHandler(createVendorRestaurantCategory),
);
router.get("/orders", validate(vendorOrderQuerySchema), asyncHandler(getVendorOrders));
router.get("/orders/:id", validate(cuidParamSchema), asyncHandler(getVendorOrderById));
router.patch(
  "/orders/:id/status",
  validate(vendorOrderStatusUpdateSchema),
  asyncHandler(updateVendorOrderStatus),
);
router.get("/menu-items", asyncHandler(getVendorMenuItems));
router.post(
  "/menu-items",
  validate(menuItemCreateSchema),
  asyncHandler(createVendorMenuItem),
);
router.patch(
  "/menu-items/:id",
  validate(menuItemUpdateSchema),
  asyncHandler(updateVendorMenuItem),
);
router.patch(
  "/menu-items/:id/availability",
  validate(menuItemAvailabilitySchema),
  asyncHandler(updateVendorMenuItemAvailability),
);

module.exports = router;
