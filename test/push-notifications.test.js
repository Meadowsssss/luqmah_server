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

test("registerPushToken upserts the authenticated user's token", async () => {
  let capturedArgs;
  const prisma = {
    pushToken: {
      upsert: async (args) => {
        capturedArgs = args;
        return { id: "push_1", token: args.create.token, platform: args.create.platform };
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/user.controller", {
    "../src/lib/prisma": { prisma },
  });

  const res = {
    statusCode: 200,
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
    await loaded.registerPushToken(
      {
        auth: { userId: "user_1" },
        body: { token: "fcm_token_1", platform: "android" },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.equal(capturedArgs.where.token, "fcm_token_1");
    assert.equal(capturedArgs.create.userId, "user_1");
    assert.equal(res.body.pushToken.platform, "android");
  } finally {
    cleanup();
  }
});

test("unregisterPushToken deletes the authenticated user's token", async () => {
  let capturedArgs;
  const prisma = {
    pushToken: {
      deleteMany: async (args) => {
        capturedArgs = args;
        return { count: 1 };
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/user.controller", {
    "../src/lib/prisma": { prisma },
  });

  const res = {
    body: null,
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await loaded.unregisterPushToken(
      {
        auth: { userId: "user_1" },
        body: { token: "fcm_token_1", platform: "android" },
      },
      res,
    );

    assert.deepEqual(capturedArgs, {
      where: {
        userId: "user_1",
        token: "fcm_token_1",
      },
    });
    assert.equal(res.body.message, "Push token removed.");
  } finally {
    cleanup();
  }
});

test("createOrder sends a vendor push notification", async () => {
  const pushCalls = [];
  const prisma = {
    restaurant: {
      findFirst: async () => ({
        id: "rest_1",
        isActive: true,
        isBusy: false,
        vendorId: "vendor_1",
      }),
    },
    menuItem: {
      findMany: async () => [
        {
          id: "item_1",
          restaurantId: "rest_1",
          title: "Burger",
          price: 5,
          optionGroups: [],
        },
      ],
    },
    order: {
      create: async () => ({
        id: "order_1",
        customerId: "cust_1",
        restaurant: { id: "rest_1", title: "Campus Bites", address: "Main Street", coverImage: null },
        rating: null,
        orderItems: [],
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/lib/push-notifications": {
      sendPushToVendor(payload) {
        pushCalls.push(payload);
        return Promise.resolve();
      },
    },
  });

  const res = { status() { return this; }, json() {} };

  try {
    await loaded.createOrder(
      {
        auth: { role: "CUSTOMER", userId: "cust_1" },
        body: { restaurantId: "rest_1", items: [{ menuItemId: "item_1", quantity: 1 }] },
      },
      res,
    );

    assert.equal(pushCalls.length, 1);
    assert.equal(pushCalls[0].vendorId, "vendor_1");
    assert.equal(pushCalls[0].title, "New order received");
  } finally {
    cleanup();
  }
});

test("updateVendorOrderStatus sends a customer push when order becomes ready", async () => {
  const pushCalls = [];
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        status: "IN_PROGRESS",
        customerId: "cust_1",
        restaurantId: "rest_1",
        readyAt: null,
      }),
      update: async ({ data }) => ({
        id: "order_1",
        status: data.status,
        customerId: "cust_1",
        restaurantId: "rest_1",
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/lib/push-notifications": {
      sendPushToUser(payload) {
        pushCalls.push(payload);
        return Promise.resolve();
      },
    },
    "../src/realtime/socket-events": {
      EVENT_TYPES: { ORDER_UPDATED: "order.updated" },
      realtime: { notifyUser() {}, notifyVendor() {}, notifyRole() {} },
    },
  });

  const res = { json() {} };

  try {
    await loaded.updateVendorOrderStatus(
      {
        auth: { vendorId: "vendor_1" },
        params: { id: "order_1" },
        body: { status: "READY" },
      },
      res,
    );

    assert.equal(pushCalls.length, 1);
    assert.equal(pushCalls[0].userId, "cust_1");
    assert.equal(pushCalls[0].title, "Your order is ready");
  } finally {
    cleanup();
  }
});
