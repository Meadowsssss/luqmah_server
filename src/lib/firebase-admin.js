let firebaseAuth;
let firebaseMessaging;

const firebaseEnv = () => ({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY,
});

const hasFirebaseConfig = () => {
  const { projectId, clientEmail, privateKey } = firebaseEnv();
  return Boolean(projectId && clientEmail && privateKey);
};

const getFirebaseApp = () => {
  if (!hasFirebaseConfig()) {
    return null;
  }

  const { cert, getApp, getApps, initializeApp } = require("firebase-admin/app");
  const { projectId, clientEmail, privateKey } = firebaseEnv();

  return getApps().length > 0
    ? getApp()
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
      });
};

const getFirebaseAuth = () => {
  if (!hasFirebaseConfig()) {
    return null;
  }

  if (!firebaseAuth) {
    const { getAuth } = require("firebase-admin/auth");
    firebaseAuth = getAuth(getFirebaseApp());
  }

  return firebaseAuth;
};

const getFirebaseMessagingClient = () => {
  if (!hasFirebaseConfig()) {
    return null;
  }

  if (!firebaseMessaging) {
    const { getMessaging } = require("firebase-admin/messaging");
    firebaseMessaging = getMessaging(getFirebaseApp());
  }

  return firebaseMessaging;
};

module.exports = { getFirebaseAuth, getFirebaseMessagingClient };
