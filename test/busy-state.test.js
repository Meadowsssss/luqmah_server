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

test("createOrder rejects busy restaurants", async () => {
  const prisma = {
    restaurant: {
      findFirst: async () => ({ id: "rest_1", isActive: true, isBusy: true }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () =>
        loaded.createOrder(
          {
            auth: { role: "CUSTOMER", userId: "cust_1" },
            body: { restaurantId: "rest_1", items: [{ menuItemId: "item_1", quantity: 1 }] },
          },
          {},
        ),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /busy right now/i);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("updateVendorRestaurantBusyState updates vendor-owned restaurant", async () => {
  const updatedRestaurant = { id: "rest_1", title: "Campus Bites", isBusy: true };
  const prisma = {
    restaurant: {
      findFirst: async () => ({ id: "rest_1", vendorId: "vendor_1" }),
      update: async ({ data }) => ({ ...updatedRestaurant, isBusy: data.isBusy }),
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
    await loaded.updateVendorRestaurantBusyState(
      {
        auth: { vendorId: "vendor_1" },
        body: { restaurantId: "rest_1", isBusy: true },
      },
      res,
    );

    assert.deepEqual(res.body, {
      restaurant: { id: "rest_1", title: "Campus Bites", isBusy: true },
    });
  } finally {
    cleanup();
  }
});
