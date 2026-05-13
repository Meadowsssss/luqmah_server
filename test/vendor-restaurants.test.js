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
