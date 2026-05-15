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

test("deleteVendorMenuItem deletes vendor-owned item and notifies realtime listeners", async () => {
  const notifications = [];
  const prisma = {
    menuItem: {
      findFirst: async () => ({
        id: "item_1",
        restaurant: { id: "rest_1" },
      }),
      delete: async ({ where }) => ({ id: where.id }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/realtime/socket-events": {
      EVENT_TYPES: { MENU_UPDATED: "menu.updated" },
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
    await loaded.deleteVendorMenuItem(
      {
        auth: { vendorId: "vendor_1" },
        params: { id: "item_1" },
      },
      res,
    );

    assert.deepEqual(res.body, { deletedItemId: "item_1" });
    assert.equal(notifications.length, 2);
    assert.equal(notifications[0].target, "vendor");
    assert.equal(notifications[0].vendorId, "vendor_1");
    assert.equal(notifications[0].payload.type, "menu.updated");
    assert.equal(notifications[0].payload.action, "deleted");
    assert.equal(notifications[0].payload.menuItemId, "item_1");
    assert.equal(notifications[0].payload.restaurantId, "rest_1");
    assert.equal(notifications[0].payload.vendorId, "vendor_1");
    assert.equal(notifications[1].target, "role");
    assert.equal(notifications[1].role, "CUSTOMER");
    assert.equal(notifications[1].payload.type, "menu.updated");
    assert.equal(notifications[1].payload.action, "deleted");
    assert.equal(notifications[1].payload.menuItemId, "item_1");
    assert.equal(notifications[1].payload.restaurantId, "rest_1");
  } finally {
    cleanup();
  }
});

test("updateVendorMenuItem rejects moving a product to another restaurant", async () => {
  const prisma = {
    menuItem: {
      findFirst: async () => ({
        id: "item_1",
        restaurantId: "rest_1",
        categoryId: "cat_1",
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  try {
    await assert.rejects(
      () =>
        loaded.updateVendorMenuItem(
          {
            auth: { vendorId: "vendor_1" },
            params: { id: "item_1" },
            body: { restaurantId: "rest_2" },
          },
          {},
        ),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "MENU_ITEM_RESTAURANT_LOCKED");
        return true;
      },
    );
  } finally {
    cleanup();
  }
});
