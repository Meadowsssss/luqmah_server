const { cert, getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { env } = require("../config/env");

let firebaseAuth;

const hasFirebaseConfig = () =>
  Boolean(
    env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY,
  );

const getFirebaseAuth = () => {
  if (!hasFirebaseConfig()) {
    return null;
  }

  if (!firebaseAuth) {
    const app =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            credential: cert({
              projectId: env.FIREBASE_PROJECT_ID,
              clientEmail: env.FIREBASE_CLIENT_EMAIL,
              privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            }),
          });

    firebaseAuth = getAuth(app);
  }

  return firebaseAuth;
};

module.exports = { getFirebaseAuth };
