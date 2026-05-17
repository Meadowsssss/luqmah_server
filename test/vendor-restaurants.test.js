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

test("getVendorRestaurants includes menu categories for product form", async () => {
  let capturedArgs;
  const prisma = {
    restaurant: {
      findMany: async (args) => {
        capturedArgs = args;
        return [
          {
            id: "rest_1",
            title: "Campus Bites",
            menuCategories: [
              { id: "cat_1", title: "Sandwiches", sortOrder: 0 },
              { id: "cat_2", title: "Burgers", sortOrder: 1 },
            ],
            _count: { menuItems: 0, orders: 0 },
          },
        ];
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
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
    await loaded.getVendorRestaurants({ auth: { vendorId: "vendor_1" } }, res);

    assert.deepEqual(capturedArgs.include.menuCategories.orderBy, [
      { sortOrder: "asc" },
      { title: "asc" },
    ]);
    assert.equal(res.body.restaurants[0].menuCategories.length, 2);
    assert.equal(res.body.restaurants[0].menuCategories[0].title, "Sandwiches");
  } finally {
    cleanup();
  }
});

test("updateVendorProfile updates the signed-in vendor name", async () => {
  const prisma = {
    user: {
      update: async ({ where, data }) => ({
        id: where.id,
        name: data.name,
        email: "vendor@example.com",
        phoneNumber: null,
        role: "VENDOR",
        createdAt: new Date("2026-05-18T10:00:00.000Z"),
        updatedAt: new Date("2026-05-18T10:05:00.000Z"),
        vendor: { id: "vendor_1" },
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
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
    await loaded.updateVendorProfile(
      {
        auth: { userId: "user_1", vendorId: "vendor_1" },
        body: { name: "Campus Team" },
      },
      res,
    );

    assert.equal(res.body.user.name, "Campus Team");
    assert.equal(res.body.user.vendor.id, "vendor_1");
  } finally {
    cleanup();
  }
});

test("updateVendorRestaurant edits vendor-owned restaurant details", async () => {
  const notifications = [];
  const prisma = {
    restaurant: {
      findFirst: async () => ({ id: "rest_1", vendorId: "vendor_1" }),
      update: async ({ data }) => ({
        id: "rest_1",
        title: data.title,
        description: data.description,
        address: data.address,
        coverImage: data.coverImage,
        isBusy: false,
        menuCategories: [],
        _count: { menuItems: 3, orders: 2 },
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/realtime/socket-events": {
      EVENT_TYPES: { RESTAURANT_UPDATED: "restaurant.updated" },
      realtime: {
        notifyVendor(vendorId, payload) {
          notifications.push({ target: "vendor", vendorId, payload });
        },
        notifyRole(role, payload) {
          notifications.push({ target: "role", role, payload });
        },
      },
    },
  });

  const res = {
    body: null,
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await loaded.updateVendorRestaurant(
      {
        auth: { vendorId: "vendor_1" },
        params: { id: "rest_1" },
        body: {
          title: "Campus Bites Plus",
          description: "Fresh plates",
          address: "Main Street",
          coverImage: "https://example.com/cover.jpg",
        },
      },
      res,
    );

    assert.equal(res.body.restaurant.title, "Campus Bites Plus");
    assert.equal(res.body.restaurant.description, "Fresh plates");
    assert.equal(notifications.length, 2);
    assert.equal(notifications[0].payload.type, "restaurant.updated");
    assert.equal(notifications[0].payload.restaurantId, "rest_1");
  } finally {
    cleanup();
  }
});
