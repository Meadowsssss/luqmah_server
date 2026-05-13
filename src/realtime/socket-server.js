const WebSocket = require("ws");
const { authenticateSocketToken } = require("./socket-auth");
const { realtime } = require("./socket-events");

const attachRealtimeServer = (server) => {
  const webSocketServer = new WebSocket.Server({ server, path: "/realtime" });

  webSocketServer.on("connection", (socket) => {
    let authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.close(4001, "Authentication required");
      }
    }, 5000);

    socket.on("message", async (rawMessage) => {
      if (authenticated) {
        return;
      }

      try {
        const message = JSON.parse(rawMessage.toString());
        if (message.type !== "auth" || !message.token) {
          socket.close(4001, "Authentication required");
          return;
        }

        const auth = await authenticateSocketToken(message.token);
        authenticated = true;
        clearTimeout(authTimeout);
        realtime.register(socket, auth);
        socket.send(JSON.stringify({ type: "realtime.ready" }));
      } catch (_error) {
        socket.close(4003, "Authentication failed");
      }
    });
  });

  return webSocketServer;
};

module.exports = { attachRealtimeServer };
