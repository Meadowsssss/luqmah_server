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

test("deleteVendor rejects vendors with active orders", async () => {
  const prisma = {
    vendor: {
      findUnique: async () => ({
        id: "vendor_1",
        userId: "user_1",
        restaurants: [{ id: "rest_1" }],
      }),
    },
    order: {
      findFirst: async () => ({ id: "order_1" }),
    },
    user: {
      delete: async () => {
        throw new Error("user.delete should not be called when active orders exist");
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/admin.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/utils/jwt": { signToken: () => "token" },
  });

  try {
    await assert.rejects(
      () => loaded.deleteVendor({ params: { id: "vendor_1" } }, {}),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /active orders/i);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("deleteVendor allows vendors with only completed or cancelled orders", async () => {
  let deletedUserId = null;
  const prisma = {
    vendor: {
      findUnique: async () => ({
        id: "vendor_1",
        userId: "user_1",
        restaurants: [{ id: "rest_1" }],
      }),
    },
    order: {
      findFirst: async () => null,
    },
    user: {
      delete: async ({ where }) => {
        deletedUserId = where.id;
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/admin.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/utils/jwt": { signToken: () => "token" },
  });

  const res = {
    body: null,
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await loaded.deleteVendor({ params: { id: "vendor_1" } }, res);

    assert.equal(deletedUserId, "user_1");
    assert.deepEqual(res.body, { message: "Vendor deleted successfully." });
  } finally {
    cleanup();
  }
});

test("getMyOrders returns historical orders even when restaurant is deleted", async () => {
  const prisma = {
    order: {
      findMany: async () => [
        {
          id: "order_1",
          status: "COMPLETED",
          totalAmount: 12.5,
          createdAt: new Date("2026-05-13T12:00:00.000Z"),
          updatedAt: new Date("2026-05-13T12:05:00.000Z"),
          restaurant: null,
          orderItems: [
            {
              id: "item_1",
              itemTitle: "Falafel Wrap",
              unitPrice: 12.5,
              quantity: 1,
              lineTotal: 12.5,
              customizations: [],
              menuItem: null,
            },
          ],
        },
      ],
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
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
    await loaded.getMyOrders({ auth: { userId: "cust_1" } }, res);

    assert.equal(res.body.orders.length, 1);
    assert.equal(res.body.orders[0].status, "COMPLETED");
    assert.equal(res.body.orders[0].restaurant, null);
    assert.equal(res.body.orders[0].orderItems[0].itemTitle, "Falafel Wrap");
  } finally {
    cleanup();
  }
});
