const test = require("node:test");
const assert = require("node:assert/strict");

function loadControllerWithMocks(modulePath, mocks) {
  const resolvedMocks = [];

  for (const [requestPath, exports] of Object.entries(mocks)) {
    const resolved = require.resolve(requestPath, { paths: [__dirname] });
    resolvedMocks.push(resolved);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports,
    };
  }

  const resolvedModule = require.resolve(modulePath, { paths: [__dirname] });
  delete require.cache[resolvedModule];
  const loaded = require(resolvedModule);

  return {
    loaded,
    cleanup() {
      delete require.cache[resolvedModule];
      for (const resolved of resolvedMocks) {
        delete require.cache[resolved];
      }
    },
  };
}

test("rateOrder creates a rating for a completed owned order", async () => {
  let createdRating;
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        customerId: "customer_1",
        restaurantId: "restaurant_1",
        status: "COMPLETED",
        rating: null,
      }),
    },
    orderRating: {
      create: async ({ data }) => {
        createdRating = data;
        return { id: "rating_1", ...data };
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await loaded.rateOrder(
      { auth: { userId: "customer_1" }, params: { id: "order_1" }, body: { score: 5 } },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.deepEqual(createdRating, {
      orderId: "order_1",
      restaurantId: "restaurant_1",
      customerId: "customer_1",
      score: 5,
    });
  } finally {
    cleanup();
  }
});

test("rateOrder rejects non-completed orders", async () => {
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        restaurantId: "restaurant_1",
        status: "READY",
        rating: null,
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () => loaded.rateOrder(
        { auth: { userId: "customer_1" }, params: { id: "order_1" }, body: { score: 4 } },
        {},
      ),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "ORDER_NOT_COMPLETED");
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("rateOrder rejects duplicate ratings", async () => {
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        restaurantId: "restaurant_1",
        status: "COMPLETED",
        rating: { id: "rating_1", score: 5 },
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () => loaded.rateOrder(
        { auth: { userId: "customer_1" }, params: { id: "order_1" }, body: { score: 4 } },
        {},
      ),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "ORDER_ALREADY_RATED");
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("rateOrder rejects another customer's order", async () => {
  const prisma = {
    order: {
      findFirst: async () => null,
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () => loaded.rateOrder(
        { auth: { userId: "customer_1" }, params: { id: "order_2" }, body: { score: 4 } },
        {},
      ),
      (error) => {
        assert.equal(error.statusCode, 404);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("dismissOrderRatingPrompt only dismisses latest completed order", async () => {
  const prisma = {
    order: {
      findFirst: async () => ({ id: "order_latest", status: "COMPLETED", rating: null }),
      update: async () => {
        throw new Error("update should not be called for older order");
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () => loaded.dismissOrderRatingPrompt(
        { auth: { userId: "customer_1" }, params: { id: "order_old" } },
        {},
      ),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "LATEST_COMPLETED_ORDER_REQUIRED");
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("manual history rating works for older completed orders", async () => {
  let created = false;
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_old",
        restaurantId: "restaurant_1",
        status: "COMPLETED",
        rating: null,
      }),
    },
    orderRating: {
      create: async ({ data }) => {
        created = true;
        return { id: "rating_1", ...data };
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });
  const res = { status: () => res, json() {} };

  try {
    await loaded.rateOrder(
      { auth: { userId: "customer_1" }, params: { id: "order_old" }, body: { score: 3 } },
      res,
    );

    assert.equal(created, true);
  } finally {
    cleanup();
  }
});

test("cancelMyOrder cancels an accepted customer order", async () => {
  let updatedStatus;
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        customerId: "customer_1",
        restaurantId: "restaurant_1",
        status: "ACCEPTED",
        restaurant: {
          id: "restaurant_1",
          vendorId: "vendor_1",
          title: "Campus Bites",
          address: "Main Street",
          coverImage: null,
        },
        rating: null,
        orderItems: [],
      }),
      update: async ({ data }) => {
        updatedStatus = data.status;
        return {
          id: "order_1",
          customerId: "customer_1",
          restaurantId: "restaurant_1",
          status: data.status,
          restaurant: {
            id: "restaurant_1",
            vendorId: "vendor_1",
            title: "Campus Bites",
            address: "Main Street",
            coverImage: null,
          },
          rating: null,
          orderItems: [],
        };
      },
    },
  };

  const customerEvents = [];
  const vendorEvents = [];
  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/realtime/socket-events": {
      EVENT_TYPES: { ORDER_UPDATED: "ORDER_UPDATED" },
      realtime: {
        notifyUser(_userId, event) {
          customerEvents.push(event);
        },
        notifyVendor(_vendorId, event) {
          vendorEvents.push(event);
        },
      },
    },
  });
  const res = { body: null, json(payload) { this.body = payload; } };

  try {
    await loaded.cancelMyOrder(
      { auth: { userId: "customer_1" }, params: { id: "order_1" } },
      res,
    );

    assert.equal(updatedStatus, "CANCELLED");
    assert.equal(res.body.order.status, "CANCELLED");
    assert.equal(customerEvents.length, 1);
    assert.equal(vendorEvents.length, 1);
  } finally {
    cleanup();
  }
});

test("cancelMyOrder rejects non-accepted orders", async () => {
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        customerId: "customer_1",
        restaurantId: "restaurant_1",
        status: "IN_PROGRESS",
        restaurant: {
          id: "restaurant_1",
          vendorId: "vendor_1",
          title: "Campus Bites",
          address: "Main Street",
          coverImage: null,
        },
        rating: null,
        orderItems: [],
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () => loaded.cancelMyOrder(
        { auth: { userId: "customer_1" }, params: { id: "order_1" } },
        {},
      ),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "ORDER_CANCELLATION_NOT_ALLOWED");
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("restaurant responses include aggregate rating values", async () => {
  const prisma = {
    restaurant: {
      findMany: async () => [
        {
          id: "restaurant_1",
          title: "Campus Bites",
          ratings: [{ score: 5 }, { score: 4 }],
          _count: { menuCategories: 1, menuItems: 2, ratings: 2 },
        },
      ],
    },
    order: {
      findMany: async () => [
        {
          inProgressStartedAt: "2026-05-16T10:00:00.000Z",
          readyAt: "2026-05-16T10:14:00.000Z",
        },
      ],
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/restaurant.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });
  const res = {
    body: null,
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await loaded.getRestaurants({}, res);

    assert.equal(res.body.restaurants[0].averageRating, 4.5);
    assert.equal(res.body.restaurants[0].ratingCount, 2);
    assert.equal(res.body.restaurants[0].estimatedPrepMinutes, 14);
    assert.equal("ratings" in res.body.restaurants[0], false);
  } finally {
    cleanup();
  }
});
