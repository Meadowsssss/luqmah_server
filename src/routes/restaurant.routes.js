const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../utils/async-handler");
const { validate } = require("../middleware/validate");
const {
  getRestaurants,
  getRestaurantById,
  getRestaurantMenu,
} = require("../controllers/restaurant.controller");

const router = express.Router();

const restaurantIdSchema = z.object({
  params: z.object({
    id: z.string().cuid(),
  }),
});

router.get("/", asyncHandler(getRestaurants));
router.get("/:id", validate(restaurantIdSchema), asyncHandler(getRestaurantById));
router.get("/:id/menu", validate(restaurantIdSchema), asyncHandler(getRestaurantMenu));

module.exports = router;
