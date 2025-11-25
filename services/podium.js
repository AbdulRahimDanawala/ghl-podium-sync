// services/podium.js
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();

const tokenFile = path.join(process.cwd(), "tokens.json");
const baseURL = process.env.PODIUM_BASE_URL;

// -------------------
// Token Store
// -------------------
function saveTokens(tokens) {
  let allTokens = {};
  if (fs.existsSync(tokenFile)) allTokens = JSON.parse(fs.readFileSync(tokenFile));
  allTokens.podium = tokens;
  fs.writeFileSync(tokenFile, JSON.stringify(allTokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(tokenFile)) return {};
  const allTokens = JSON.parse(fs.readFileSync(tokenFile));
  return allTokens.podium || {};
}

// -------------------
// OAuth callback
// -------------------
export async function podiumCallback(req, res) {
  const { code, error, error_description } = req.query;
  if (error) return res.send(`<h1>OAuth Error:</h1><p>${error_description}</p>`);
  if (!code) return res.send("<h2>❌ No code param received from Podium.</h2>");

  try {
    const tokens = await exchangeCodeForToken(code);
    saveTokens(tokens);

    // After OAuth, automatically create webhook
    await createPodiumWebhook(tokens.access_token);

    res.send(`<h2>✅ Podium Tokens saved and webhook created successfully</h2><pre>${JSON.stringify(tokens, null, 2)}</pre>`);
  } catch (err) {
    res.status(500).send(`<h2>❌ Error exchanging code:</h2><pre>${err.message}</pre>`);
  }
}

// -------------------
// Exchange code → token
// -------------------
export async function exchangeCodeForToken(code) {
  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("client_id", process.env.PODIUM_CLIENT_ID);
  params.append("client_secret", process.env.PODIUM_CLIENT_SECRET);
  params.append("redirect_uri", process.env.PODIUM_REDIRECT_URI);

  const { data } = await axios.post("https://api.podium.com/oauth/token", params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000
  };
}

// -------------------
// Refresh token
// -------------------
async function refreshTokenIfNeeded() {
  let tokens = loadTokens();
  if (!tokens.access_token || Date.now() >= (tokens.expires_at || 0)) {
    if (!tokens.refresh_token) throw new Error("No Podium refresh token available");

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", tokens.refresh_token);
    params.append("client_id", process.env.PODIUM_CLIENT_ID);
    params.append("client_secret", process.env.PODIUM_CLIENT_SECRET);

    const { data } = await axios.post("https://api.podium.com/oauth/token", params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    };

    saveTokens(tokens);
  }
  return tokens.access_token;
}

// -------------------
// Send message
// -------------------
// export async function sendToPodium(phoneNumber, message) {
//   const accessToken = await refreshTokenIfNeeded();
//   const url = `${baseURL}/messages`;
//   const res = await axios.post(
//     url,
//     {
//       locationUid: process.env.PODIUM_LOCATION_ID,
//       phoneNumber,
//       message
//     },
//     {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         "Content-Type": "application/json"
//       }
//     }
//   );
//   return res.data;
// }

export async function sendToPodium(phoneNumber, message, name) {
  const accessToken = await refreshTokenIfNeeded();
  const url = `${baseURL}/messages`;

  const payload = {
    channel: {
      type: "phone",
      identifier: phoneNumber   // MUST be phone number in + format
    },
    setOpenInbox: false,
    body: message,
    contactName: name,     // optional → Podium accepts it
    locationUid: process.env.PODIUM_LOCATION_ID
  };

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    console.log("📨 Podium Message Sent:", res.data);
    return res.data;

  } catch (err) {
    console.error("❌ Podium Send Error:", err.response?.data || err.message);
    throw err;
  }
}





// -------------------
// Create webhook automatically
// -------------------
// export async function createPodiumWebhook(accessToken) {
//   const url = `${baseURL}/webhooks`;

//   try {
//     await axios.post(
//       url,
//       {
//         locationUid: process.env.PODIUM_LOCATION_ID,
//         event: "messages.inbound",
//         targetUrl: `${process.env.PODIUM_REDIRECT_URI.replace("/callback", "")}/webhook/podium`
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${accessToken}`,
//           "Content-Type": "application/json"
//         }
//       }
//     );
//     console.log("✅ Podium webhook created successfully");
//   } catch (err) {
//     console.error("❌ Error creating Podium webhook:", err.response?.data || err.message);
//   }
// }
export async function createPodiumWebhook(accessToken) {
  const url = `${baseURL}/webhooks`;
  const base = process.env.PODIUM_REDIRECT_URI.split("/oauth")[0];

  try {
    await axios.post(
      url,
      {
        locationUid: process.env.PODIUM_LOCATION_ID,
        url: `${base}/webhook/podium`,
        eventTypes: ["message.received"]  // <-- correct
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("✅ Podium webhook created successfully");
  } catch (err) {
    console.error("❌ Error creating Podium webhook:", err.response?.data || err.message);
  }
}
