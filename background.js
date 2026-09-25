import { DEFAULT_BLOCKLIST } from './defaultBlocklist.js';
import { COMPILED_KEYWORD_REGEXES } from './defaultKeywords.js';
import { deriveKeyFromPin, encryptData, decryptData } from './cryptoUtils.js';

const SAFESEARCH_RULE_IDS = [101, 102, 103];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Google OAuth Configuration
const GOOGLE_CLIENT_ID = "369511086314-8queep6f1a9ki2n2jsvtajv1i3iekcrp.apps.googleusercontent.com";
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email"
];

// State guard for search query deduplication
let lastLoggedSearch = { query: "", time: 0 };

// ==========================================
// 0. UTILITIES & DEVICE IDENTIFICATION
// ==========================================
function isMicrosoftEdge() {
  return navigator.userAgent.includes("Edg/");
}

function getCleanTimestamp() {
  return new Date().toISOString();
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = "Desktop";
  
  if (ua.includes("Win")) os = "Windows PC";
  else if (ua.includes("Mac")) os = "Macbook";
  else if (ua.includes("Android")) os = "Android Phone";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS Device";

  const browser = isMicrosoftEdge() ? "Edge" : "Chrome";
  return `${os} (${browser})`;
}

// Helper to get active derived key for current user
async function getActiveEncryptionKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["userPin", "userEmail"], async (res) => {
      const pin = res.userPin || "1234";
      const email = res.userEmail || "user@virtue.app";
      try {
        const { key, keyHex } = await deriveKeyFromPin(pin, email);
        resolve({ key, keyHex });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function sanitizeStringForTesting(str) {
  if (!str) return "";
  try {
    return decodeURIComponent(str).replace(/\+/g, " ");
  } catch (e) {
    return str.replace(/\+/g, " ");
  }
}

function extractSearchQuery(urlStr) {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname;
    if ((domain.includes("google.com") && url.pathname.includes("/search")) ||
        (domain.includes("bing.com") && url.pathname.includes("/search")) ||
        (domain.includes("duckduckgo.com") && url.pathname === "/")) {
      const queryParam = url.searchParams.get("q");
      if (queryParam) {
        return decodeURIComponent(queryParam.replace(/\+/g, " "));
      }
    }
  } catch (e) { console.error("URL Parse error:", e); }
  return null;
}

function makeFileUnlisted(fileId) {
  authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  })
  .then(res => res.json())
  .then(data => console.log("Drive file permissions set to Anyone with link:", data))
  .catch(err => console.error("Error setting Drive permissions:", err));
}

function base64EncodeUtf8(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode('0x' + p1);
  }))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
}

// ==========================================
// 1. DUAL-ENGINE AUTHENTICATION ROUTER
// ==========================================
function notifyActiveTabOfAuthFailure() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "SHOW_REAUTH_BANNER" }).catch(() => {});
    }
  });
}

function clearAuthFailureBanner() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: "HIDE_REAUTH_BANNER" }).catch(() => {});
    });
  });
}

function fetchNewToken(interactive, resolve, reject) {
  if (isMicrosoftEdge()) {
    // Edge Path: launchWebAuthFlow
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&` +
      `response_type=token&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(OAUTH_SCOPES.join(" "))}`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        return reject(chrome.runtime.lastError?.message || "Failed to retrieve token");
      }

      const matches = redirectUrl.match(/access_token=([^&]+)/);
      const token = matches ? matches[1] : null;

      if (token) {
        chrome.storage.local.set({ authToken: token }, () => resolve(token));
      } else {
        reject("Token parsing failed");
      }
    });
  } else {
    // Chrome Path: Native getAuthToken
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        return reject(chrome.runtime.lastError?.message || "Failed to retrieve token");
      }
      chrome.storage.local.set({ authToken: token }, () => resolve(token));
    });
  }
}

async function authenticatedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["authToken"], async (res) => {
      let token = res.authToken;

      if (!token) {
        try {
          token = await new Promise((resToken, rejToken) => fetchNewToken(false, resToken, rejToken));
        } catch (silentErr) {
          notifyActiveTabOfAuthFailure();
          return reject("No valid authorization token available.");
        }
      }

      options.headers = { ...options.headers, "Authorization": `Bearer ${token}` };

      try {
        let response = await fetch(url, options);

        if (response.status === 401) {
          chrome.storage.local.remove(["authToken"]);
          try {
            const freshToken = await new Promise((resToken, rejToken) => fetchNewToken(false, resToken, rejToken));
            options.headers["Authorization"] = `Bearer ${freshToken}`;
            response = await fetch(url, options);
          } catch (retryErr) {
            notifyActiveTabOfAuthFailure();
            return reject("Auth token expired and silent refresh failed.");
          }
        }
        resolve(response);
      } catch (err) { reject(err); }
    });
  });
}

// ==========================================
// 1.1 GMAIL API DISPATCHER
// ==========================================
async function sendGmailNotification({ toEmail, subject, bodyHtml, bodyText }) {
  if (!toEmail) {
    console.error("Virtue Email Error: No recipient email provided.");
    return false;
  }

  const encodedSubject = `=?UTF-8?B?${btoa(encodeURIComponent(subject).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)))}?=`;
  const isHtml = Boolean(bodyHtml);
  const contentType = isHtml ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"';
  const contentBody = isHtml ? bodyHtml : bodyText;

  const emailLines = [
    `To: ${toEmail}`,
    `Subject: ${encodedSubject}`,
    `Content-Type: ${contentType}`,
    'MIME-Version: 1.0',
    '',
    contentBody
  ];

  const rawMessage = emailLines.join('\r\n');
  const encodedMessage = base64EncodeUtf8(rawMessage);

  try {
    const res = await authenticatedFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encodedMessage })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Virtue Email Error [Status ${res.status}]:`, errText);
      return false;
    }

    console.log("Virtue Email Success: Dispatched to", toEmail);
    return true;
  } catch (err) {
    console.error("Virtue Email Fetch Exception:", err);
    return false;
  }
}

// ==========================================
// 2. INITIALIZE ALARMS & RULES
// ==========================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("flushBuffer", { periodInMinutes: 1 });
  chrome.alarms.create("checkWeeklyDigest", { periodInMinutes: 1440 });

  chrome.storage.local.get(["filterMode", "customBlacklist", "customWhitelist", "userPin"], (result) => {
    const updates = {};
    if (!result.filterMode) updates.filterMode = "blocklist";
    if (!result.customBlacklist) updates.customBlacklist = ["facebook.com", "instagram.com"];
    if (!result.customWhitelist) updates.customWhitelist = ["wikipedia.org", "google.com"];
    if (!result.userPin) updates.userPin = "1234";

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates, () => { updateDynamicSafeSearchRules(); });
    } else {
      updateDynamicSafeSearchRules();
    }
  });
});

chrome.runtime.onStartup.addListener(() => { updateDynamicSafeSearchRules(); });

function updateDynamicSafeSearchRules() {
  const newRules = [
    {
      id: 101,
      priority: 1,
      action: { type: "redirect", redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: "safe", value: "active" }] } } } },
      condition: { urlFilter: "||google.com/search", resourceTypes: ["main_frame"] }
    },
    {
      id: 102,
      priority: 1,
      action: { type: "redirect", redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: "adlt", value: "strict" }] } } } },
      condition: { urlFilter: "||bing.com/search", resourceTypes: ["main_frame"] }
    },
    {
      id: 103,
      priority: 1,
      action: { type: "redirect", redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: "kp", value: "1" }] } } } },
      condition: { urlFilter: "||duckduckgo.com", resourceTypes: ["main_frame"] }
    }
  ];

  chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: SAFESEARCH_RULE_IDS, addRules: newRules });
}

function addToBuffer(data) {
  chrome.storage.local.get({ logBuffer: [] }, (result) => {
    const buffer = result.logBuffer;
    buffer.push(data);
    chrome.storage.local.set({ logBuffer: buffer });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flushBuffer") {
    flushBufferToDriveJson();
  } else if (alarm.name === "checkWeeklyDigest") {
    checkAndSendWeeklyDigest();
  }
});

async function checkAndSendWeeklyDigest() {
  chrome.storage.local.get([
    "userName", "partnerName", "partnerEmail", "driveFileId", "lastWeeklyDigestSentAt"
  ], async (data) => {
    if (!data.partnerEmail || !data.driveFileId) return;

    const now = Date.now();
    const lastSent = data.lastWeeklyDigestSentAt || 0;
    if (now - lastSent < SEVEN_DAYS_MS) return;

    await dispatchReportSnapshot(data, "🛡️ Virtue Weekly Accountability Digest");
    chrome.storage.local.set({ lastWeeklyDigestSentAt: now });
  });
}

async function dispatchReportSnapshot(profileData, customSubjectPrefix) {
  try {
    const { key, keyHex } = await getActiveEncryptionKey();
    const res = await authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${profileData.driveFileId}?alt=media`);
    const fileData = await res.json();
    
    let logs = [];
    if (fileData.encryptedData && fileData.iv) {
      logs = await decryptData(fileData.encryptedData, fileData.iv, key);
    } else {
      logs = fileData.logs || [];
    }

    const validSearches = logs.filter(l => l.searchQuery && l.searchQuery.trim() !== "" && l.searchQuery.trim().toUpperCase() !== "N/A");
    const ignoredWarnings = logs.filter(l => (l.title && l.title.includes("[VISITED]")) || (l.url && l.url.includes("virtue_bypass=true")));

    const domainCounts = {};
    logs.forEach(l => {
      try {
        if (l.url && l.url.startsWith("http")) {
          const domain = new URL(l.url).hostname.replace('www.', '');
          domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        }
      } catch (e) {}
    });
    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const userName = profileData.userName || "User";
    const partnerName = profileData.partnerName || "Partner";
    const dashboardUrl = `https://tbehman.github.io/virtue-extension/?fileId=${profileData.driveFileId}#key=${keyHex}`;

    let warningsHtml = "";
    if (ignoredWarnings.length > 0) {
      warningsHtml = `
        <div style="background-color: #fff3cd; border: 1px solid #ffe69c; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #664d03; font-size: 15px;">⚠️ Restricted Sites Visited (${ignoredWarnings.length} Ignored Warnings)</h3>
          <ul style="margin: 0; padding-left: 20px; color: #664d03; font-size: 13px;">
            ${ignoredWarnings.map(w => `
              <li style="margin-bottom: 6px;">
                <strong>${new Date(w.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</strong> - 
                <em>"${w.title ? w.title.replace("[VISITED]", "").trim() : "Untitled"}"</em><br>
                <a href="${w.url}" style="color: #664d03; word-break: break-all;">${w.url}</a>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    const domainRowsHtml = topDomains.length > 0 
      ? topDomains.map(([domain, count]) => `
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e9ecef; font-size: 13px;"><strong>${domain}</strong></td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e9ecef; font-size: 13px; text-align: right;">${count} visits</td>
          </tr>
        `).join('')
      : `<tr><td colspan="2" style="padding: 12px; text-align: center; color: #6c757d; font-size: 13px;">No browsing activity logged</td></tr>`;

    const searchRowsHtml = validSearches.length > 0
      ? validSearches.slice(0, 10).map(s => `
          <li style="margin-bottom: 6px; font-size: 13px; color: #212529;">
            <strong>"${s.searchQuery}"</strong> 
            <span style="color: #6c757d; font-size: 11px;">(${new Date(s.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })})</span>
          </li>
        `).join('')
      : `<li style="font-size: 13px; color: #6c757d;">No search queries recorded</li>`;

    const bodyHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e9ecef; overflow: hidden; padding: 25px;">
          <div style="display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #198754; padding-bottom: 15px; margin-bottom: 20px;">
            <img src="https://raw.githubusercontent.com/tbehman/virtue-extension/main/docs/virtue_logo.png" alt="Virtue Logo" style="height: 48px; width: auto; vertical-align: middle;">
            <h2 style="margin: 0; color: #198754; font-size: 22px;">Virtue Accountability Report</h2>
          </div>
          <p style="font-size: 14px; color: #212529;">Hello ${partnerName},</p>
          <p style="font-size: 14px; color: #6c757d; line-height: 1.5;">Here is the latest accountability report snapshot for <strong>${userName}</strong>.</p>
          ${warningsHtml}
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; background: #f8f9fa; border-radius: 8px;">
            <tr>
              <td style="padding: 12px; text-align: center; border-right: 1px solid #e9ecef;">
                <div style="font-size: 11px; color: #6c757d; text-transform: uppercase;">Total Searches</div>
                <div style="font-size: 20px; font-weight: bold; color: #198754;">${validSearches.length}</div>
              </td>
              <td style="padding: 12px; text-align: center;">
                <div style="font-size: 11px; color: #6c757d; text-transform: uppercase;">Ignored Warnings</div>
                <div style="font-size: 20px; font-weight: bold; color: ${ignoredWarnings.length > 0 ? '#dc3545' : '#198754'};">${ignoredWarnings.length}</div>
              </td>
            </tr>
          </table>
          <h3 style="font-size: 15px; color: #212529; margin-bottom: 10px;">📊 Top Visited Domains</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
            ${domainRowsHtml}
          </table>
          <h3 style="font-size: 15px; color: #212529; margin-bottom: 10px;">🔍 Recent Search Queries</h3>
          <ul style="padding-left: 20px; margin-bottom: 25px;">
            ${searchRowsHtml}
          </ul>
          <div style="text-align: center; border-top: 1px solid #e9ecef; padding-top: 20px; margin-top: 20px;">
            <a href="${dashboardUrl}" target="_blank" style="background-color: #198754; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">View Full Web Dashboard ➔</a>
          </div>
          <p style="font-size: 12px; color: #6c757d; text-align: center; margin-top: 25px;">Blessings,<br><strong>Virtue Accountability Team</strong></p>
        </div>
      </body>
      </html>
    `;

    const subject = `${customSubjectPrefix} for ${userName}`;
    await sendGmailNotification({ toEmail: profileData.partnerEmail, subject: subject, bodyHtml: bodyHtml });
  } catch (err) {
    console.error("Report snapshot dispatch error:", err);
  }
}

// ==========================================
// 3. DRIVE JSON SYNC ENGINE (WITH BLOCKLIST SYNC)
// ==========================================
function flushBufferToDriveJson() {
  chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
    addToBuffer({
      type: "HEARTBEAT",
      incognitoAllowed: isAllowed,
      device: getDeviceInfo(),
      timestamp: getCleanTimestamp()
    });

    chrome.storage.local.get({ logBuffer: [], driveFileId: "" }, (result) => {
      const buffer = result.logBuffer;
      let driveFileId = result.driveFileId;
      if (buffer.length === 0) return;

      let uniqueLogs = Array.from(new Set(buffer.map(a => a.url || a.timestamp))).map(key => buffer.find(a => (a.url || a.timestamp) === key));

      if (!driveFileId) {
        findDriveJsonFileOnly((fileId) => { 
          if (fileId) syncLogsToDriveFile(fileId, uniqueLogs); 
        });
      } else {
        syncLogsToDriveFile(driveFileId, uniqueLogs);
      }
    });
  });
}

function findDriveJsonFileOnly(callback) {
  const query = encodeURIComponent("name = 'virtue_logs.json' and trashed = false");
  authenticatedFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`)
    .then(res => res.json())
    .then(data => {
      if (data.files && data.files.length > 0) {
        const fileId = data.files[0].id;
        makeFileUnlisted(fileId);
        chrome.storage.local.set({ driveFileId: fileId }, () => callback(fileId));
      } else {
        callback(null);
      }
    })
    .catch(() => callback(null));
}

function syncLogsToDriveFile(fileId, newLogs) {
  authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { "Cache-Control": "no-cache" }
  })
  .then(async (res) => {
    const etag = res.headers.get("ETag");
    let fileData = { metadata: { version: "1.0" } };
    let existingLogs = [];

    const { key } = await getActiveEncryptionKey();

    try { 
      fileData = await res.json(); 
      if (fileData.encryptedData && fileData.iv) {
        existingLogs = await decryptData(fileData.encryptedData, fileData.iv, key);
      } else if (fileData.logs) {
        existingLogs = fileData.logs;
      }
    } catch (e) {}

    chrome.storage.local.get([
      "userName", "partnerName", "partnerEmail", "userEmail", 
      "customBlacklist", "customWhitelist", "customKeywords", "filterMode", "settingsLastUpdated"
    ], async (localProfile) => {
      const logMap = new Map();
      [...existingLogs, ...newLogs].forEach(log => {
        const uniqueKey = `${log.timestamp}_${log.url || log.type || ''}`;
        logMap.set(uniqueKey, log);
      });
      const combined = Array.from(logMap.values());

      const cutoffTime = Date.now() - SEVEN_DAYS_MS;
      const rollingLogs = combined.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        return !isNaN(logTime) && logTime > cutoffTime;
      });

      const encrypted = await encryptData(rollingLogs, key);

      const driveMeta = fileData.metadata || {};
      const profileUpdates = {};

      // Profile Sync
      if (!localProfile.userName && driveMeta.userName) profileUpdates.userName = driveMeta.userName;
      if (!localProfile.partnerName && driveMeta.partnerName) profileUpdates.partnerName = driveMeta.partnerName;
      if (!localProfile.partnerEmail && driveMeta.partnerEmail) profileUpdates.partnerEmail = driveMeta.partnerEmail;
      if (!localProfile.userEmail && driveMeta.userEmail) profileUpdates.userEmail = driveMeta.userEmail;

      // Filter/Blocklist Sync (Master State pattern)
      const driveSettingsTime = driveMeta.settingsLastUpdated || 0;
      const localSettingsTime = localProfile.settingsLastUpdated || 0;

      if (driveSettingsTime > localSettingsTime) {
        if (driveMeta.customBlacklist) profileUpdates.customBlacklist = driveMeta.customBlacklist;
        if (driveMeta.customWhitelist) profileUpdates.customWhitelist = driveMeta.customWhitelist;
        if (driveMeta.customKeywords) profileUpdates.customKeywords = driveMeta.customKeywords;
        if (driveMeta.filterMode) profileUpdates.filterMode = driveMeta.filterMode;
        profileUpdates.settingsLastUpdated = driveSettingsTime;
      }

      if (Object.keys(profileUpdates).length > 0) chrome.storage.local.set(profileUpdates);

      const activeSettingsTime = Math.max(localSettingsTime, driveSettingsTime);
      const activeBlacklist = localSettingsTime >= driveSettingsTime ? (localProfile.customBlacklist || driveMeta.customBlacklist || []) : (driveMeta.customBlacklist || []);
      const activeWhitelist = localSettingsTime >= driveSettingsTime ? (localProfile.customWhitelist || driveMeta.customWhitelist || []) : (driveMeta.customWhitelist || []);
      const activeKeywords  = localSettingsTime >= driveSettingsTime ? (localProfile.customKeywords || driveMeta.customKeywords || []) : (driveMeta.customKeywords || []);
      const activeFilterMode = localSettingsTime >= driveSettingsTime ? (localProfile.filterMode || driveMeta.filterMode || "blocklist") : (driveMeta.filterMode || "blocklist");

      const updatedPayload = {
        metadata: {
          ...driveMeta,
          version: "1.0",
          userName: localProfile.userName || driveMeta.userName || "",
          partnerName: localProfile.partnerName || driveMeta.partnerName || "",
          partnerEmail: localProfile.partnerEmail || driveMeta.partnerEmail || "",
          userEmail: localProfile.userEmail || driveMeta.userEmail || "",
          customBlacklist: activeBlacklist,
          customWhitelist: activeWhitelist,
          customKeywords: activeKeywords,
          filterMode: activeFilterMode,
          settingsLastUpdated: activeSettingsTime,
          lastUpdated: getCleanTimestamp()
        },
        iv: encrypted.iv,
        encryptedData: encrypted.ciphertext
      };

      const uploadHeaders = { "Content-Type": "application/json" };
      if (etag) uploadHeaders["If-Match"] = etag;

      authenticatedFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: uploadHeaders,
        body: JSON.stringify(updatedPayload)
      })
      .then(uploadRes => {
        if (uploadRes.status === 412) {
          const randomJitter = Math.floor(Math.random() * 500) + 200;
          setTimeout(() => syncLogsToDriveFile(fileId, newLogs), randomJitter);
        } else if (uploadRes.ok) {
          chrome.storage.local.set({ logBuffer: [] });
        }
      })
      .catch(err => console.error("Upload error:", err));
    });
  })
  .catch(err => {
    console.warn("Sync fetch error:", err);
  });
}

// ==========================================
// 4. HIGH-PERFORMANCE INTERCEPTION ENGINE
// ==========================================
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; 
  const urlStr = details.url;
  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) return;
  if (urlStr.includes("virtue_bypass=true")) return;

  chrome.storage.local.get({ filterMode: "blocklist", customBlacklist: [], customWhitelist: [], customKeywords: [] }, (settings) => {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase().trim();
      const searchQuery = extractSearchQuery(urlStr);
      const isYahooMediaLeak = hostname.startsWith("images.search.yahoo.com") || hostname.startsWith("video.search.yahoo.com");

      let shouldBlock = false;
      let blockReason = "domain";

      const matchesCustomList = (domainList) => {
        return domainList.some(domain => {
          const cleanDomain = domain.toLowerCase().trim();
          return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
        });
      };

      if (settings.filterMode === "whitelist") {
        shouldBlock = !matchesCustomList(settings.customWhitelist);
      } else {
        const inCustomBlacklist = matchesCustomList(settings.customBlacklist);

        let inStaticShield = false;
        const parts = hostname.split('.');
        for (let i = 0; i < parts.length - 1; i++) {
          const rootDomain = parts.slice(i).join('.');
          if (DEFAULT_BLOCKLIST.has(rootDomain)) {
            inStaticShield = true;
            break;
          }
        }

        shouldBlock = inCustomBlacklist || inStaticShield || isYahooMediaLeak;

        if (!shouldBlock) {
          const cleanUrlStr = sanitizeStringForTesting(urlStr).toLowerCase();
          const rawQuery = searchQuery ? searchQuery.toLowerCase() : "";
          const targetText = `${cleanUrlStr} ${rawQuery}`;

          const userKeywords = (settings.customKeywords || []).map(k => {
            try { return new RegExp(`\\b${k.trim()}\\b`, 'i'); } catch (e) { return null; }
          }).filter(Boolean);

          const allRegexes = [...COMPILED_KEYWORD_REGEXES, ...userKeywords];

          for (const regex of allRegexes) {
            if (regex.test(targetText) || (rawQuery && regex.test(rawQuery))) {
              shouldBlock = true;
              blockReason = "keyword";
              break;
            }
          }
        }
      }

      if (shouldBlock) {
        const blockPageUrl = chrome.runtime.getURL(
          `blocked.html?target=${encodeURIComponent(urlStr)}&reason=${blockReason}`
        );
        chrome.tabs.update(details.tabId, { url: blockPageUrl });
      }
    } catch (e) { console.error("Interception error:", e); }
  });
});

// ==========================================
// 5. GENERAL NAVIGATION LOGGING
// ==========================================
function processNavigation(url, tabId) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (url.includes(chrome.runtime.id) && url.includes("blocked.html")) return;

  chrome.tabs.get(tabId).then((tab) => {
    if (!tab) return;

    let title = tab.title || "";
    const searchQuery = extractSearchQuery(url);
    const cleanLocalTime = getCleanTimestamp();

    if (searchQuery) {
      const now = Date.now();
      if (
        searchQuery.toLowerCase() === lastLoggedSearch.query.toLowerCase() && 
        (now - lastLoggedSearch.time < 5000)
      ) {
        return;
      }
      lastLoggedSearch = { query: searchQuery, time: now };
    }

    if (tab.incognito) { title = `[INCOGNITO] ${title}`; }
    let finalUrl = url;
    if (url.includes("virtue_bypass=true")) {
      finalUrl = url.replace(/[?&]virtue_bypass=true/, "");
      title = `[VISITED] ${title}`;
    }

    addToBuffer({
      url: finalUrl,
      title: title || "Untitled Page",
      searchQuery: searchQuery || "",
      device: getDeviceInfo(),
      timestamp: cleanLocalTime,
      flagged: finalUrl.includes("[BLOCKED]")
    });
  }).catch(() => {});
}

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  processNavigation(details.url, details.tabId);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  processNavigation(details.url, details.tabId);
});

// ==========================================
// 6. MESSAGE LISTENERS FOR POPUP & RE-AUTH ACTIONS
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TRIGGER_INTERACTIVE_AUTH") {
    fetchNewToken(true, (token) => {
      clearAuthFailureBanner();
      flushBufferToDriveJson();
    }, (err) => {
      console.error("Interactive auth failed:", err);
    });
    return true;
  }

  if (request.type === "RECOVER_USER_PIN") {
    chrome.storage.local.get(["userPin", "userName", "userEmail"], (data) => {
      const targetEmail = data.userEmail;

      if (!targetEmail) {
        console.error("Virtue PIN Recovery Error: Profile email not available");
        sendResponse({ success: false, error: "No user email found" });
        return;
      }

      const userPin = data.userPin || "1234";
      const userName = data.userName || "Friend";

      const subject = "🔑 Your Virtue PIN Recovery";
      const bodyHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #198754; margin-top: 0;">Virtue Security Recovery</h2>
          <p>Hello ${userName},</p>
          <p>You requested recovery for your 4-digit Virtue security PIN.</p>
          <div style="background-color: #f1f5f9; padding: 15px; font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; border-radius: 8px; color: #0f172a; margin: 20px 0;">
            ${userPin}
          </div>
          <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
            If you did not request this PIN recovery, please check your Virtue extension settings.
          </p>
        </div>
      `;

      sendGmailNotification({
        toEmail: targetEmail,
        subject: subject,
        bodyHtml: bodyHtml
      }).then(success => sendResponse({ success }));
    });
    return true;
  }

  if (request.type === "SEND_PARTNER_CHANGE_ALERT") {
    const subject = "⚠️ Virtue Security Alert: Partner Email Modified";
    const bodyText = `Hello ${request.partnerName || 'Partner'},\n\nThis is an automated security notification from Virtue. ` +
      `${request.userName || 'User'} has updated their designated accountability partner email from ${request.oldEmail} to ${request.newEmail}.\n\n` +
      `If you did not discuss or authorize this change, please contact them directly.\n\n` +
      `Blessings,\nVirtue Security`;

    sendGmailNotification({
      toEmail: request.oldEmail,
      subject: subject,
      bodyText: bodyText
    }).then((success) => sendResponse({ success }));
    return true;
  }

  if (request.type === "SWITCH_GOOGLE_ACCOUNT") {
    flushBufferToDriveJson();

    chrome.storage.local.get(["userName", "partnerName", "partnerEmail", "driveFileId", "authToken"], async (profile) => {
      if (profile.partnerEmail && profile.driveFileId) {
        await dispatchReportSnapshot(profile, "⚠️ Virtue Pre-Disconnect Accountability Snapshot");
      }

      const token = profile.authToken;
      if (token) {
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
          .finally(() => {
            chrome.storage.local.remove(["authToken", "driveFileId", "userEmail"], () => {
              sendResponse({ success: true });
            });
          });
      } else {
        chrome.storage.local.remove(["authToken", "driveFileId", "userEmail"], () => {
          sendResponse({ success: true });
        });
      }
    });
    return true;
  }
});