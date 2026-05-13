require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const restaurantRoutes = require("./routes/restaurant.routes");
const orderRoutes = require("./routes/order.routes");
const vendorRoutes = require("./routes/vendor.routes");
const adminRoutes = require("./routes/admin.routes");
const { notFoundHandler, errorHandler } = require("./middleware/error-handler");

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/restaurants", restaurantRoutes);
app.use("/orders", orderRoutes);
app.use("/vendor", vendorRoutes);
app.use("/admin", adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app };
