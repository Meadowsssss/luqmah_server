require("dotenv").config();

const http = require("http");
const { app } = require("./app");
const { env } = require("./config/env");
const { prisma } = require("./lib/prisma");
const { attachRealtimeServer } = require("./realtime/socket-server");

const server = http.createServer(app);
attachRealtimeServer(server);

server.listen(env.PORT, () => {
  console.log(`Luqmah API listening on port ${env.PORT}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
