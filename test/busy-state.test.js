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

test("createOrder rejects customers with an existing active order", async () => {
  const prisma = {
    restaurant: {
      findFirst: async () => ({
        id: "rest_1",
        isActive: true,
        isBusy: false,
        vendorId: "vendor_1",
      }),
    },
    order: {
      findFirst: async ({ where }) => (where?.status?.in ? { id: "order_active_1" } : null),
    },
    vendorBlacklist: {
      findUnique: async () => null,
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
        assert.equal(error.code, "CUSTOMER_ACTIVE_ORDER_EXISTS");
        assert.match(error.message, /already have an order in progress/i);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("updateVendorOrderStatus stores ETA fields when order enters in progress", async () => {
  let updatedData;
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        status: "ACCEPTED",
        restaurantId: "rest_1",
        customerId: "cust_1",
        inProgressStartedAt: null,
        readyAt: null,
      }),
      findMany: async () => [
        {
          inProgressStartedAt: "2026-05-16T10:00:00.000Z",
          readyAt: "2026-05-16T10:12:00.000Z",
        },
        {
          inProgressStartedAt: "2026-05-16T11:00:00.000Z",
          readyAt: "2026-05-16T11:18:00.000Z",
        },
      ],
      update: async ({ data }) => {
        updatedData = data;
        return {
          id: "order_1",
          status: data.status,
          estimatedReadyAt: data.estimatedReadyAt,
          customerId: "cust_1",
          restaurantId: "rest_1",
          orderItems: [],
          customer: null,
          restaurant: null,
        };
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/realtime/socket-events": {
      EVENT_TYPES: { ORDER_UPDATED: "ORDER_UPDATED" },
      realtime: { notifyUser() {}, notifyVendor() {}, notifyRole() {} },
    },
  });

  const res = { json() {} };

  try {
    await loaded.updateVendorOrderStatus(
      {
        auth: { vendorId: "vendor_1" },
        params: { id: "order_1" },
        body: { status: "IN_PROGRESS" },
      },
      res,
    );

    assert.equal(updatedData.status, "IN_PROGRESS");
    assert.ok(updatedData.inProgressStartedAt instanceof Date);
    assert.ok(updatedData.estimatedReadyAt instanceof Date);
  } finally {
    cleanup();
  }
});

test("updateVendorOrderStatus stores readyAt when order becomes ready", async () => {
  let updatedData;
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        status: "IN_PROGRESS",
        restaurantId: "rest_1",
        customerId: "cust_1",
        inProgressStartedAt: new Date("2026-05-16T10:00:00.000Z"),
        readyAt: null,
      }),
      update: async ({ data }) => {
        updatedData = data;
        return {
          id: "order_1",
          status: data.status,
          customerId: "cust_1",
          restaurantId: "rest_1",
          orderItems: [],
          customer: null,
          restaurant: null,
        };
      },
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
    "../src/realtime/socket-events": {
      EVENT_TYPES: { ORDER_UPDATED: "ORDER_UPDATED" },
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

    assert.equal(updatedData.status, "READY");
    assert.ok(updatedData.readyAt instanceof Date);
  } finally {
    cleanup();
  }
});

test("updateVendorOrderStatus sends the full updated order to customer realtime events", async () => {
  const customerEvents = [];
  const vendorEvents = [];
  const prisma = {
    order: {
      findFirst: async () => ({
        id: "order_1",
        status: "IN_PROGRESS",
        restaurantId: "rest_1",
        customerId: "cust_1",
        inProgressStartedAt: new Date("2026-05-16T10:00:00.000Z"),
        readyAt: null,
      }),
      update: async ({ data }) => ({
        id: "order_1",
        status: data.status,
        customerId: "cust_1",
        restaurantId: "rest_1",
        estimatedReadyAt: new Date("2026-05-16T10:15:00.000Z"),
        orderItems: [],
        customer: null,
        restaurant: null,
      }),
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/vendor.controller", {
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
        notifyRole() {},
      },
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

    assert.equal(customerEvents.length, 1);
    assert.equal(customerEvents[0].type, "ORDER_UPDATED");
    assert.equal(customerEvents[0].order.id, "order_1");
    assert.equal(customerEvents[0].order.status, "READY");
    assert.equal(vendorEvents.length, 1);
  } finally {
    cleanup();
  }
});

test("createOrder requires selections for required single-choice groups", async () => {
  const prisma = {
    restaurant: {
      findFirst: async () => ({ id: "rest_1", isActive: true, isBusy: false, vendorId: "vendor_1" }),
    },
    order: {
      findFirst: async ({ where }) => (where?.status?.in ? null : null),
    },
    menuItem: {
      findMany: async () => [
        {
          id: "item_1",
          restaurantId: "rest_1",
          title: "Coffee",
          price: 2,
          optionGroups: [
            {
              id: "group_1",
              title: "Size",
              selectionType: "SINGLE",
              isRequired: true,
              options: [
                { id: "opt_small", title: "Small", priceDelta: 0 },
                { id: "opt_large", title: "Large", priceDelta: 1 },
              ],
            },
          ],
        },
      ],
    },
    vendorBlacklist: {
      findUnique: async () => null,
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
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /size is required/i);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("createOrder includes selected option price deltas in totals", async () => {
  let createdOrderPayload;
  const prisma = {
    restaurant: {
      findFirst: async () => ({ id: "rest_1", isActive: true, isBusy: false, vendorId: "vendor_1" }),
    },
    order: {
      findFirst: async ({ where }) => (where?.status?.in ? null : null),
      create: async ({ data }) => {
        createdOrderPayload = data;
        return { id: "order_1", customerId: "cust_1", restaurant: null, rating: null, orderItems: [] };
      },
    },
    menuItem: {
      findMany: async () => [
        {
          id: "item_1",
          restaurantId: "rest_1",
          title: "Coffee",
          price: 2,
          optionGroups: [
            {
              id: "group_1",
              title: "Size",
              selectionType: "SINGLE",
              isRequired: true,
              options: [
                { id: "opt_large", title: "Large", priceDelta: 1 },
              ],
            },
          ],
        },
      ],
    },
    vendorBlacklist: {
      findUnique: async () => null,
    },
  };

  const { loaded, cleanup } = loadControllerWithMocks("../src/controllers/order.controller", {
    "../src/lib/prisma": { prisma },
    "../src/utils/serialize": { serialize: (value) => value },
  });

  const res = { status() { return this; }, json() {} };

  try {
    await loaded.createOrder(
      {
        auth: { role: "CUSTOMER", userId: "cust_1" },
        body: {
          restaurantId: "rest_1",
          items: [{ menuItemId: "item_1", quantity: 2, optionIds: ["opt_large"] }],
        },
      },
      res,
    );

    assert.equal(Number(createdOrderPayload.totalAmount), 6);
    assert.equal(createdOrderPayload.orderItems.create[0].customizations.create[0].title, "Size: Large");
  } finally {
    cleanup();
  }
});
