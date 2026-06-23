const bcrypt = require("bcryptjs");
const { prisma } = require("../lib/prisma");
const { getFirebaseAuth } = require("../lib/firebase-admin");
const { USER_ROLES } = require("../constants/enums");
const { signToken } = require("../utils/jwt");
const { serialize } = require("../utils/serialize");
const { ApiError } = require("../utils/api-error");
const {
  hasBlockedDisplayNameTerm,
  isLettersAndSpacesName,
  normalizeDisplayName,
} = require("../utils/profile-validation");

const authUserSelect = {
  id: true,
  name: true,
  email: true,
  phoneNumber: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  vendor: {
    select: {
      id: true,
    },
  },
};

const customerPasswordAuthDisabledError = () =>
  new ApiError(403, "Customers must authenticate with Firebase.", {
    code: "CUSTOMER_FIREBASE_AUTH_REQUIRED",
  });

const splitEmailForLogin = (value) => {
  const email = value?.trim();
  if (!email) {
    return null;
  }

  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex == email.length - 1) {
    return null;
  }

  return {
    email,
    localPart: email.slice(0, atIndex),
    normalizedDomain: email.slice(atIndex + 1).toLowerCase(),
  };
};

const findUserByDomainInsensitiveEmail = async (email) => {
  const parts = splitEmailForLogin(email);
  if (!parts) {
    return null;
  }

  const users = await prisma.user.findMany({
    where: {
      email: {
        startsWith: `${parts.localPart}@`,
      },
    },
    include: {
      vendor: {
        select: { id: true },
      },
    },
  });

  return (
    users.find((user) => {
      const userParts = splitEmailForLogin(user.email);
      return userParts?.normalizedDomain === parts.normalizedDomain;
    }) ?? null
  );
};

const register = async (_req, _res) => {
  throw customerPasswordAuthDisabledError();
};

const login = async (req, res) => {
  const email = req.body.email?.trim();
  const { password } = req.body;

  const user = await findUserByDomainInsensitiveEmail(email);

  if (!user || !user.passwordHash) {
    throw new ApiError(401, "Invalid email or password", {
      code: "INVALID_CREDENTIALS",
    });
  }

  if (user.role === USER_ROLES.CUSTOMER) {
    throw customerPasswordAuthDisabledError();
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    throw new ApiError(401, "Invalid email or password", {
      code: "INVALID_CREDENTIALS",
    });
  }

  const token = signToken(user);

  res.json({
    token,
    user: serialize({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      vendor: user.vendor,
    }),
  });
};

const validateCustomerProfileInput = ({ name, phoneNumber }) => {
  if (name != null) {
    if (!isLettersAndSpacesName(name)) {
      throw new ApiError(400, "Use letters and spaces only.", {
        code: "INVALID_CUSTOMER_NAME_FORMAT",
      });
    }

    if (hasBlockedDisplayNameTerm(name)) {
      throw new ApiError(400, "Choose a different display name.", {
        code: "INAPPROPRIATE_CUSTOMER_NAME",
      });
    }
  }

  if (phoneNumber != null && !/^[0-9+\- ]+$/.test(phoneNumber)) {
    throw new ApiError(400, "Use digits, spaces, +, or - only.", {
      code: "INVALID_CUSTOMER_PHONE_NUMBER",
    });
  }
};

const syncCustomerWithFirebase = async (req, res) => {
  const { idToken } = req.body;
  const requestedName = req.body.name?.trim();
  const requestedPhoneNumber = req.body.phoneNumber?.trim();
  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth) {
    throw new ApiError(
      500,
      "Firebase Admin credentials are missing on the backend.",
      { code: "FIREBASE_AUTH_NOT_CONFIGURED" },
    );
  }

  let decodedToken;
  try {
    decodedToken = await firebaseAuth.verifyIdToken(idToken);
  } catch (_error) {
    throw new ApiError(401, "Invalid Firebase ID token.", {
      code: "INVALID_FIREBASE_ID_TOKEN",
    });
  }

  const email = decodedToken.email?.trim().toLowerCase();
  if (!email) {
    throw new ApiError(400, "Firebase user email is required.", {
      code: "FIREBASE_EMAIL_REQUIRED",
    });
  }

  if (decodedToken.email_verified !== true) {
    throw new ApiError(403, "Verify your email before continuing.", {
      code: "FIREBASE_EMAIL_NOT_VERIFIED",
    });
  }

  const firebaseUid = decodedToken.uid;
  const fallbackName =
    decodedToken.name?.trim() || email.split("@")[0] || "Luqmah Customer";

  const [linkedUser, emailUser] = await Promise.all([
    prisma.user.findUnique({
      where: { firebaseUid },
      select: authUserSelect,
    }),
    prisma.user.findUnique({
      where: { email },
      select: authUserSelect,
    }),
  ]);

  if (
    linkedUser &&
    linkedUser.role !== USER_ROLES.CUSTOMER
  ) {
    throw new ApiError(
      409,
      "This Firebase account belongs to a non-customer workspace.",
      { code: "AUTH_ROLE_MISMATCH" },
    );
  }

  if (
    emailUser &&
    emailUser.role !== USER_ROLES.CUSTOMER
  ) {
    throw new ApiError(
      409,
      "This email belongs to a non-customer workspace.",
      { code: "AUTH_ROLE_MISMATCH" },
    );
  }

  if (linkedUser && emailUser && linkedUser.id !== emailUser.id) {
    throw new ApiError(
      409,
      "Firebase identity is already linked to a different account.",
      { code: "FIREBASE_ACCOUNT_CONFLICT" },
    );
  }

  const existingCustomer = linkedUser || emailUser;
  const resolvedName =
    requestedName || existingCustomer?.name?.trim() || fallbackName;

  validateCustomerProfileInput({
    name: resolvedName,
    phoneNumber: requestedPhoneNumber,
  });

  const user = existingCustomer
    ? await prisma.user.update({
        where: { id: existingCustomer.id },
        data: {
          email,
          firebaseUid,
          name: normalizeDisplayName(resolvedName)
            .split(" ")
            .map((part) =>
              part ? part[0].toUpperCase() + part.slice(1) : part,
            )
            .join(" "),
          ...(requestedPhoneNumber
            ? { phoneNumber: requestedPhoneNumber }
            : {}),
          role: USER_ROLES.CUSTOMER,
        },
        select: authUserSelect,
      })
    : await prisma.user.create({
        data: {
          email,
          firebaseUid,
          name: normalizeDisplayName(resolvedName)
            .split(" ")
            .map((part) =>
              part ? part[0].toUpperCase() + part.slice(1) : part,
            )
            .join(" "),
          phoneNumber: requestedPhoneNumber ?? null,
          role: USER_ROLES.CUSTOMER,
          passwordHash: null,
        },
        select: authUserSelect,
      });

  const token = signToken(user);

  res.json({
    token,
    user: serialize(user),
  });
};

const me = async (req, res) => {
  res.json({
    user: serialize({
      id: req.auth.user.id,
      name: req.auth.user.name,
      email: req.auth.user.email,
      phoneNumber: req.auth.user.phoneNumber,
      role: req.auth.user.role,
      createdAt: req.auth.user.createdAt,
      updatedAt: req.auth.user.updatedAt,
      vendor: req.auth.user.vendor,
    }),
  });
};

module.exports = { register, login, syncCustomerWithFirebase, me };
