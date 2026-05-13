const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { USER_ROLES } = require("../constants/enums");
const {
  createOrder,
  getMyOrders,
  getMyOrderById,
} = require("../controllers/order.controller");

const router = express.Router();

const createOrderSchema = z.object({
  body: z.object({
    restaurantId: z.string().cuid(),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          menuItemId: z.string().cuid(),
          quantity: z.number().int().positive().max(20),
          customizationIds: z.array(z.string().cuid()).optional(),
        }),
      )
      .min(1),
  }),
});

const orderIdSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
});

router.post(
  "/",
  requireAuth,
  requireRole(USER_ROLES.CUSTOMER),
  validate(createOrderSchema),
  asyncHandler(createOrder),
);
router.get("/me", requireAuth, requireRole(USER_ROLES.CUSTOMER), asyncHandler(getMyOrders));
router.get(
  "/me/:id",
  requireAuth,
  requireRole(USER_ROLES.CUSTOMER),
  validate(orderIdSchema),
  asyncHandler(getMyOrderById),
);

module.exports = router;
