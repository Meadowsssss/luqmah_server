const { env } = require("../config/env");

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_USER_SELECT = "displayName";

let cachedToken = null;

const hasMicrosoftGraphConfig = () => Boolean(
  env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET,
);

const fetchMicrosoftGraphToken = async () => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: GRAPH_SCOPE,
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  if (!json.access_token) {
    return null;
  }

  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + ((json.expires_in ?? 3600) * 1000),
  };

  return cachedToken.accessToken;
};

const getMicrosoftDisplayNameByEmail = async (email) => {
  if (!hasMicrosoftGraphConfig()) {
    return null;
  }

  try {
    const token = await fetchMicrosoftGraphToken();
    if (!token) {
      return null;
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=${GRAPH_USER_SELECT}`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    return json.displayName?.trim() || null;
  } catch (_error) {
    return null;
  }
};

module.exports = { getMicrosoftDisplayNameByEmail };
