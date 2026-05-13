const test = require("node:test");
const assert = require("node:assert/strict");
const { createRealtimeHub, EVENT_TYPES } = require("../src/realtime/socket-events");

function createSocket() {
  return {
    readyState: 1,
    sent: [],
    handlers: {},
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    on(event, handler) {
      this.handlers[event] = handler;
    },
  };
}

test("notifyUser sends events only to matching user sockets", () => {
  const hub = createRealtimeHub();
  const matching = createSocket();
  const other = createSocket();

  hub.register(matching, { userId: "user_1", role: "CUSTOMER" });
  hub.register(other, { userId: "user_2", role: "CUSTOMER" });

  const sent = hub.notifyUser("user_1", {
    type: EVENT_TYPES.ORDER_UPDATED,
    orderId: "order_1",
  });

  assert.equal(sent, 1);
  assert.equal(matching.sent[0].type, EVENT_TYPES.ORDER_UPDATED);
  assert.equal(other.sent.length, 0);
});

test("notifyVendor sends events only to matching vendor sockets", () => {
  const hub = createRealtimeHub();
  const matching = createSocket();
  const customer = createSocket();

  hub.register(matching, { userId: "user_1", vendorId: "vendor_1", role: "VENDOR" });
  hub.register(customer, { userId: "user_2", role: "CUSTOMER" });

  const sent = hub.notifyVendor("vendor_1", {
    type: EVENT_TYPES.MENU_UPDATED,
    restaurantId: "restaurant_1",
  });

  assert.equal(sent, 1);
  assert.equal(matching.sent[0].type, EVENT_TYPES.MENU_UPDATED);
  assert.equal(customer.sent.length, 0);
});

test("notifyRole broadcasts to a role and removes closed sockets", () => {
  const hub = createRealtimeHub();
  const open = createSocket();
  const closed = createSocket();
  closed.readyState = 3;

  hub.register(open, { userId: "user_1", role: "CUSTOMER" });
  hub.register(closed, { userId: "user_2", role: "CUSTOMER" });

  const sent = hub.notifyRole("CUSTOMER", {
    type: EVENT_TYPES.RESTAURANT_UPDATED,
    restaurantId: "restaurant_1",
  });

  assert.equal(sent, 1);
  assert.equal(open.sent[0].type, EVENT_TYPES.RESTAURANT_UPDATED);
  assert.equal(closed.sent.length, 0);
});
