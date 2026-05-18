const { prisma } = require("./prisma");
const { getFirebaseMessagingClient } = require("./firebase-admin");

const invalidTokenErrorCodes = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

const loadPushTokens = async (where) => {
  if (!prisma.pushToken?.findMany) {
    return [];
  }
  return prisma.pushToken.findMany({
    where,
    select: { token: true },
  });
};

const sendPush = async ({ tokens, title, body, data = {} }) => {
  const messaging = getFirebaseMessagingClient();
  if (!messaging) {
    return { sentCount: 0, skipped: true };
  }

  if (!tokens.length) {
    return { sentCount: 0, skipped: true };
  }

  let response;
  try {
    response = await messaging.sendEachForMulticast({
      tokens: tokens.map((entry) => entry.token),
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value == null ? "" : String(value)]),
      ),
      android: {
        priority: "high",
      },
    });
  } catch (error) {
    console.error("Failed to send push notification", error);
    return { sentCount: 0, failureCount: tokens.length, skipped: false };
  }

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (!result.success && invalidTokenErrorCodes.has(result.error?.code)) {
      invalidTokens.push(tokens[index].token);
    }
  });

  if (invalidTokens.length) {
    await prisma.pushToken.deleteMany({
      where: { token: { in: invalidTokens } },
    });
  }

  return { sentCount: response.successCount, failureCount: response.failureCount };
};

const sendPushToUser = async ({ userId, title, body, data = {} }) => {
  const tokens = await loadPushTokens({ userId });
  return sendPush({ tokens, title, body, data });
};

const sendPushToVendor = async ({ vendorId, title, body, data = {} }) => {
  if (!prisma.vendor?.findUnique) {
    return { sentCount: 0, skipped: true };
  }
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      user: {
        select: {
          pushTokens: {
            select: { token: true },
          },
        },
      },
    },
  });
  const tokens = vendor?.user?.pushTokens ?? [];
  return sendPush({ tokens, title, body, data });
};

module.exports = { sendPushToUser, sendPushToVendor };
