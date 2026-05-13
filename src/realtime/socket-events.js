const EVENT_TYPES = {
  ORDER_CREATED: "order.created",
  ORDER_UPDATED: "order.updated",
  RESTAURANT_UPDATED: "restaurant.updated",
  MENU_UPDATED: "menu.updated",
  RATING_CREATED: "rating.created",
};

const createRealtimeHub = () => {
  const clients = new Set();

  const register = (socket, auth) => {
    const client = {
      socket,
      userId: auth.userId,
      vendorId: auth.vendorId ?? null,
      role: auth.role,
    };
    clients.add(client);
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
    return client;
  };

  const send = (client, event) => {
    if (client.socket.readyState !== 1) {
      return false;
    }
    client.socket.send(JSON.stringify(event));
    return true;
  };

  const notifyWhere = (predicate, event) => {
    let sent = 0;
    for (const client of clients) {
      if (predicate(client) && send(client, event)) {
        sent += 1;
      }
    }
    return sent;
  };

  return {
    register,
    notifyUser(userId, event) {
      return notifyWhere((client) => client.userId === userId, event);
    },
    notifyVendor(vendorId, event) {
      return notifyWhere((client) => client.vendorId === vendorId, event);
    },
    notifyRole(role, event) {
      return notifyWhere((client) => client.role === role, event);
    },
    clientCount() {
      return clients.size;
    },
  };
};

const realtime = createRealtimeHub();

module.exports = { EVENT_TYPES, createRealtimeHub, realtime };
