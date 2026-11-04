import { DEFAULT_BLOCKLIST } from './defaultBlocklist.js';
import { COMPILED_KEYWORD_REGEXES } from './defaultKeywords.js';
import { deriveKeyFromPin, encryptData, decryptData } from './cryptoUtils.js';

const isNonChromeChromium = /Edg|OPR|Brave/.test(navigator.userAgent) || !/Chrome/.test(navigator.userAgent);
if (isNonChromeChromium) {
  console.log("⚠️ Virtue extension is designed exclusively for Google Chrome. Background worker halted.");
}

// ==========================================
// VIRTUE CONFIGURATION & CONSTANTS
// ==========================================
const VIRTUE_CONFIG = {
  FILE_NAME: "virtue_logs_v1.json",
  MIME_FILE: "application/json"
};

const FILTER_MODE_STANDARD = "standard";
const FILTER_MODE_STRICT = "strict";

const SAFESEARCH_RULE_IDS = [101, 102, 103];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let lastLoggedSearch = { query: "", time: 0 };
let isSyncingPermissions = false;

// ==========================================
// 0. UTILITIES & DEVICE IDENTIFICATION
// ==========================================
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = "Desktop";
  if (ua.includes("Win")) os = "Windows PC";
  else if (ua.includes("Mac")) os = "Macbook";
  else if (ua.includes("Android")) os = "Android Phone";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS Device";
  return `${os} (Chrome)`;
}

async function getDeviceId() {
  const data = await chrome.storage.local.get("deviceId");
  if (data.deviceId) return data.deviceId;

  const newDeviceId = "dev_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
  await chrome.storage.local.set({ deviceId: newDeviceId });
  return newDeviceId;
}

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
  try { return decodeURIComponent(str).replace(/\+/g, " "); } 
  catch (e) { return str.replace(/\+/g, " "); }
}

function extractSearchQuery(urlStr) {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname.toLowerCase();
    
    const searchKeys = ["q", "query", "search_query", "p", "term", "keyword", "text"];
    
    const isSearchPath = url.pathname.includes("/search") || 
                         url.pathname.includes("/results") || 
                         url.pathname.includes("/query") ||
                         domain.includes("youtube.com") ||
                         domain.includes("google.") ||
                         domain.includes("bing.com") ||
                         domain.includes("duckduckgo.com");

    if (isSearchPath) {
      for (const key of searchKeys) {
        const val = url.searchParams.get(key);
        if (val && val.trim() !== "") {
          return decodeURIComponent(val.replace(/\+/g, " "));
        }
      }
    }
  } catch (e) { 
    console.error("URL Parse error:", e); 
  }
  return null;
}

function getNextMonday9AM() {
  const now = new Date();
  const nextMonday = new Date(now);

  const currentDay = now.getDay();
  let daysUntilMonday = (1 - currentDay + 7) % 7;

  if (daysUntilMonday === 0 && now.getHours() >= 9) {
    daysUntilMonday = 7;
  }

  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  return nextMonday.getTime();
}

async function reconcilePartnerPermissions() {
  if (isNonChromeChromium) return;
  if (isSyncingPermissions) return;

  const myDeviceId = await getDeviceId();
  const data = await chrome.storage.local.get([
    "syncStatus", "partnerEmail", "partnerName", "oldPartnerEmail", 
    "driveFileId", "syncRetryCount", "userName", "lastInitiatorDeviceId"
  ]);

  if (data.syncStatus !== "PENDING_SYNC") return;

  if (data.lastInitiatorDeviceId && data.lastInitiatorDeviceId !== myDeviceId) {
    console.log("ℹ️ Partner change initiated by another device. Syncing silently.");
    await chrome.storage.local.set({ syncStatus: "SYNCED" });
    return;
  }

  const driveFileId = data.driveFileId;
  const newEmail = (data.partnerEmail || "").trim().toLowerCase();
  const oldEmail = (data.oldPartnerEmail || "").trim().toLowerCase();
  const retryCount = data.syncRetryCount || 0;

  if (!driveFileId || !newEmail) return;

  if (retryCount >= 5) {
    console.warn("⚠️ Max ACL retries reached (5/5). Pausing execution.");
    return;
  }

  isSyncingPermissions = true;

  try {
    const listRes = await authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}/permissions?fields=permissions(id,type,role,emailAddress)`
    );

    if (!listRes.ok) throw new Error(`Drive ACL Fetch Error: ${listRes.status}`);

    const { permissions = [] } = await listRes.json();

    const hasNewPartnerAccess = permissions.some(
      p => p.emailAddress && p.emailAddress.toLowerCase() === newEmail
    );

    if (!hasNewPartnerAccess) {
      const addRes = await authenticatedFetch(
        `https://www.googleapis.com/drive/v3/files/${driveFileId}/permissions?sendNotificationEmail=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "reader", type: "user", emailAddress: newEmail })
        }
      );

      if (addRes.status === 400 || addRes.status === 404) {
        console.error("❌ Invalid target partner email. Executing local profile rollback...");
        await chrome.storage.local.set({
          partnerEmail: oldEmail,
          syncStatus: "ERROR_INVALID_EMAIL",
          syncRetryCount: 0
        });
        isSyncingPermissions = false;
        return;
      }

      if (!addRes.ok) throw new Error(`Drive ACL Grant Failed: ${addRes.status}`);
      console.log(`✅ Granted explicit reader access silently to: ${newEmail}`);

      await dispatchReportSnapshot(
        { userName: data.userName, partnerName: data.partnerName, partnerEmail: newEmail, driveFileId },
        { isWelcome: true, targetEmail: newEmail }
      );
    }

    if (oldEmail && oldEmail !== newEmail) {
      const isOldPartnerListed = permissions.some(
        p => p.emailAddress && p.emailAddress.toLowerCase() === oldEmail
      );

      if (isOldPartnerListed) {
        console.log(`Sending closing handoff snapshot email to ${oldEmail}...`);
        await dispatchReportSnapshot(
          { userName: data.userName, partnerEmail: newEmail, driveFileId },
          { isHandoff: true, targetEmail: oldEmail }
        );
      }
    }

    for (const perm of permissions) {
      if (perm.role === "owner") continue;

      if (perm.type === "anyone" || (perm.emailAddress && perm.emailAddress.toLowerCase() !== newEmail)) {
        await authenticatedFetch(
          `https://www.googleapis.com/drive/v3/files/${driveFileId}/permissions/${perm.id}`,
          { method: "DELETE" }
        );
        console.log(`🔒 Revoked stale/public access ID: ${perm.id} (${perm.emailAddress || 'anyone'})`);
      }
    }

    await chrome.storage.local.set({
      syncStatus: "SYNCED",
      syncRetryCount: 0,
      oldPartnerEmail: newEmail
    });

    console.log("✅ Partner permissions successfully synchronized and verified.");

  } catch (err) {
    console.error("ACL Reconcile Exception:", err);
    await chrome.storage.local.set({ syncRetryCount: retryCount + 1 });
  } finally {
    isSyncingPermissions = false;
  }
}

function base64EncodeUtf8(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode('0x' + p1);
  }))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
}

function calculatePeakBrowsingHours(logs) {
  if (!logs || logs.length === 0) return "N/A";

  const hourCounts = new Array(24).fill(0);
  logs.forEach(l => {
    const timeMs = l.t || l.timestamp;
    if (timeMs) {
      const hour = new Date(timeMs).getHours();
      hourCounts[hour]++;
    }
  });

  let maxVisits = 0;
  let peakStartHour = -1;

  for (let h = 0; h < 24; h++) {
    const windowVisits = hourCounts[h] + hourCounts[(h + 1) % 24];
    if (windowVisits > maxVisits) {
      maxVisits = windowVisits;
      peakStartHour = h;
    }
  }

  if (maxVisits === 0 || peakStartHour === -1) return "N/A";

  const formatHour = (h) => {
    const period = h >= 12 ? "PM" : "AM";
    let hour12 = h % 12;
    if (hour12 === 0) hour12 = 12;
    return `${hour12} ${period}`;
  };

  return `${formatHour(peakStartHour)} – ${formatHour((peakStartHour + 2) % 24)}`;
}

// ==========================================
// 1. CHROME NATIVE AUTHENTICATION & FETCH
// ==========================================
function notifyActiveTabOfAuthFailure() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id && tabs[0].url?.startsWith("http")) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "SHOW_REAUTH_BANNER" }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  });
}

function clearAuthFailureBanner() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id && tab.url?.startsWith("http")) {
        chrome.tabs.sendMessage(tab.id, { type: "HIDE_REAUTH_BANNER" }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    });
  });
}

function fetchNewToken(interactive, resolve, reject) {
  chrome.identity.getAuthToken({ interactive }, (newToken) => {
    if (chrome.runtime.lastError || !newToken) {
      return reject(chrome.runtime.lastError?.message || "Failed to retrieve token");
    }
    chrome.storage.local.set({ authToken: newToken }, () => resolve(newToken));
  });
}

async function authenticatedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    fetchNewToken(false, async (token) => {
      options.headers = { ...options.headers, "Authorization": `Bearer ${token}` };

      try {
        let response = await fetch(url, options);

        if (response.status === 401 || response.status === 403) {
          console.warn(`⚠️ Auth token rejected with status ${response.status}. Purging cache and retrying silently...`);
          chrome.identity.removeCachedAuthToken({ token }, () => {
            fetchNewToken(false, async (newToken) => {
              options.headers["Authorization"] = `Bearer ${newToken}`;
              const retryResponse = await fetch(url, options);
              if (retryResponse.ok) {
                clearAuthFailureBanner();
                return resolve(retryResponse);
              }
              notifyActiveTabOfAuthFailure();
              reject(`API request failed with status ${retryResponse.status} after silent retry`);
            }, (err) => {
              notifyActiveTabOfAuthFailure();
              reject(err);
            });
          });
          return;
        }

        clearAuthFailureBanner();
        resolve(response);
      } catch (err) {
        reject(err);
      }
    }, (err) => {
      notifyActiveTabOfAuthFailure();
      reject(err);
    });
  });
}

async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
  let delay = 1000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await authenticatedFetch(url, options);
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        throw new Error(`Transient server status: ${response.status}`);
      }
      return response;
    } catch (err) {
      if (attempt === maxRetries) {
        console.warn(`[SYNC ENGINE] Transient retry limit reached for ${url}. Preserving local buffer.`);
        throw err;
      }
      const jitter = Math.random() * 300;
      const computedDelay = delay + jitter;
      await new Promise(resolve => setTimeout(resolve, computedDelay));
      delay *= 2;
    }
  }
}

async function sendGmailNotification({ toEmail, subject, bodyHtml, bodyText }) {
  if (!toEmail) return false;

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
    return res.ok;
  } catch (err) {
    console.error("Virtue Email Fetch Exception:", err);
    return false;
  }
}

// ==========================================
// 2. INITIALIZE ALARMS & STORAGE DEFAULTS
// ==========================================
function setupAlarms() {
  if (isNonChromeChromium) return;
  chrome.alarms.get("flushBuffer", (alarm) => {
    if (!alarm || (alarm.scheduledTime && alarm.scheduledTime < Date.now())) {
      chrome.alarms.create("flushBuffer", { periodInMinutes: 1 });
    }
  });

  chrome.alarms.get("checkWeeklyReport", (alarm) => {
    if (!alarm || (alarm.scheduledTime && alarm.scheduledTime < Date.now())) {
      chrome.alarms.create("checkWeeklyReport", { periodInMinutes: 60 });
    }
  });

  chrome.alarms.get("incognitoHeartbeat", (alarm) => {
    if (!alarm || (alarm.scheduledTime && alarm.scheduledTime < Date.now())) {
      chrome.alarms.create("incognitoHeartbeat", { periodInMinutes: 15 });
    }
  });
}

function recordIncognitoHeartbeat() {
  if (isNonChromeChromium) return;
  try {
    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      addToBuffer({
        t: Date.now(),
        type: "HEARTBEAT",
        incognitoAllowed: Boolean(isAllowed),
        device: getDeviceInfo()
      });
    });
  } catch (e) {
    console.error("Heartbeat error:", e);
  }
}

if (!isNonChromeChromium) {
  chrome.runtime.onInstalled.addListener(() => {
    setupAlarms();

    chrome.storage.local.get(["filterMode", "customBlocklist", "customApprovedList", "userPin", "nextWeeklyReportDueAt"], (result) => {
      const updates = {};
      if (!result.filterMode) updates.filterMode = FILTER_MODE_STANDARD;
      if (!result.customBlocklist) updates.customBlocklist = ["facebook.com", "instagram.com"];
      if (!result.customApprovedList) updates.customApprovedList = ["wikipedia.org", "google.com"];
      if (!result.userPin) updates.userPin = "1234";
      if (!result.nextWeeklyReportDueAt) updates.nextWeeklyReportDueAt = getNextMonday9AM();

      if (Object.keys(updates).length > 0) {
        chrome.storage.local.set(updates, () => { updateDynamicSafeSearchRules(); });
      } else {
        updateDynamicSafeSearchRules();
      }
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    setupAlarms();
    updateDynamicSafeSearchRules();
    reconcilePartnerPermissions();
    checkAndSendWeeklyReport();
    recordIncognitoHeartbeat();
  });

  setupAlarms();
}

function updateDynamicSafeSearchRules() {
  if (isNonChromeChromium) return;
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
  if (isNonChromeChromium) return;
  chrome.storage.local.get({ logBuffer: [] }, (result) => {
    const buffer = result.logBuffer;
    buffer.push(data);
    if (buffer.length >= 10) {
      chrome.storage.local.set({ logBuffer: buffer }, () => {
        flushBufferToDriveJson();
      });
    } else {
      chrome.storage.local.set({ logBuffer: buffer });
    }
  });
}

if (!isNonChromeChromium) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "flushBuffer") {
      flushBufferToDriveJson();
    } else if (alarm.name === "checkWeeklyReport") {
      checkAndSendWeeklyReport();
    } else if (alarm.name === "incognitoHeartbeat") {
      recordIncognitoHeartbeat();
    }
  });
}

async function checkAndSendWeeklyReport() {
  if (isNonChromeChromium) return;
  chrome.storage.local.get([
    "userName", "partnerName", "partnerEmail", "driveFileId", 
    "lastWeeklyReportSentAt", "nextWeeklyReportDueAt"
  ], async (data) => {
    if (!data.partnerEmail || !data.driveFileId) return;

    const now = Date.now();
    const nextDue = data.nextWeeklyReportDueAt || getNextMonday9AM();

    if (now >= nextDue) {
      const success = await dispatchReportSnapshot(data, { isHandoff: false });
      if (success) {
        const newNextDue = getNextMonday9AM();
        await chrome.storage.local.set({
          lastWeeklyReportSentAt: now,
          nextWeeklyReportDueAt: newNextDue
        });
      }
    }
  });
}

async function dispatchReportSnapshot(profileData, options = {}) {
  if (isNonChromeChromium) return false;
  const isHandoff = options.isHandoff || false;
  const isWelcome = options.isWelcome || false;
  const targetEmail = options.targetEmail || profileData.partnerEmail;

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

    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - SEVEN_DAYS_MS;
    const fourteenDaysAgoMs = nowMs - (SEVEN_DAYS_MS * 2);

    const heartbeats = logs.filter(l => l.type === "HEARTBEAT");
    const browsingLogs = logs.filter(l => l.type !== "HEARTBEAT" && l.type !== "AUDIT");

    const currentWeekLogs = browsingLogs.filter(l => (l.t || l.timestamp || 0) >= sevenDaysAgoMs);
    const prevWeekLogs = browsingLogs.filter(l => {
      const time = l.t || l.timestamp || 0;
      return time >= fourteenDaysAgoMs && time < sevenDaysAgoMs;
    });

    const currentSitesCount = currentWeekLogs.length;
    const prevSitesCount = prevWeekLogs.length;
    let trendHtml = "";

    if (prevSitesCount > 0) {
      const diff = currentSitesCount - prevSitesCount;
      const pctChange = Math.round((diff / prevSitesCount) * 100);
      if (pctChange > 0) trendHtml = `<div style="font-size: 11px; color: #d97706; font-weight: 600; margin-top: 4px;">▲ ${pctChange}% vs. last week</div>`;
      else if (pctChange < 0) trendHtml = `<div style="font-size: 11px; color: #198754; font-weight: 600; margin-top: 4px;">▼ ${Math.abs(pctChange)}% vs. last week</div>`;
      else trendHtml = `<div style="font-size: 11px; color: #6c757d; font-weight: 500; margin-top: 4px;">No change vs. last week</div>`;
    }

    const peakHoursStr = calculatePeakBrowsingHours(currentWeekLogs);
    const validSearches = currentWeekLogs
      .filter(l => (l.q || l.searchQuery) && (l.q || l.searchQuery).trim() !== "" && (l.q || l.searchQuery).trim().toUpperCase() !== "N/A")
      .sort((a, b) => (b.t || b.timestamp || 0) - (a.t || a.timestamp || 0));

    const ignoredWarnings = currentWeekLogs.filter(l => l.flag === 1 || (l.title && l.title.includes("[VISITED]")) || (l.url && l.url.includes("virtue_bypass=true")));
    
    let noticeHtml = "";
    let hasAuditNotice = false;

    const devices = {};
    heartbeats.forEach(hb => {
      const devName = hb.device || "Primary Device";
      if (!devices[devName]) devices[devName] = [];
      devices[devName].push(hb);
    });

    Object.entries(devices).forEach(([devName, beats]) => {
      beats.sort((a, b) => new Date(a.timestamp || a.t) - new Date(b.timestamp || b.t));
      const unmonitoredWindows = [];
      let currentWindowStart = null;

      beats.forEach((hb, idx) => {
        const hbTime = new Date(hb.timestamp || hb.t);
        if (!hb.incognitoAllowed) {
          if (!currentWindowStart) currentWindowStart = hbTime;
          if (idx === beats.length - 1) {
            unmonitoredWindows.push({ start: currentWindowStart, end: null });
          }
        } else {
          if (currentWindowStart) {
            unmonitoredWindows.push({ start: currentWindowStart, end: hbTime });
            currentWindowStart = null;
          }
        }
      });

      if (unmonitoredWindows.length > 0) {
        hasAuditNotice = true;
        noticeHtml += `<div style="margin-bottom: 12px;"><strong>⚠️ ${devName} — Unmonitored Incognito Window(s):</strong><ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 13px;">`;
        unmonitoredWindows.forEach(win => {
          const startStr = new Date(win.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
          if (win.end) {
            const endStr = new Date(win.end).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
            const diffMin = Math.round((win.end - win.start) / 60000);
            const durationStr = diffMin < 60 ? `${Math.max(1, diffMin)} min` : `${(diffMin / 60).toFixed(1)} hr`;
            noticeHtml += `<li>${startStr} – ${endStr} (${durationStr})</li>`;
          } else {
            noticeHtml += `<li style="color: #dc3545; font-weight: bold;">${startStr} – Present (Active Unmonitored Session)</li>`;
          }
        });
        noticeHtml += `</ul></div>`;
      }
    });

    if (ignoredWarnings.length > 0) {
      hasAuditNotice = true;
      noticeHtml += `<div><strong>🛑 Restricted Sites Visited (${ignoredWarnings.length} Ignored Warnings):</strong><ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 13px;">`;
      ignoredWarnings.forEach(w => {
        noticeHtml += `<li style="margin-bottom: 6px;">
          <strong>${new Date(w.t || w.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })}</strong> — 
          <em>"${w.title ? w.title.replace("[VISITED]", "").trim() : "Untitled"}"</em><br>
          <a href="${w.url}" style="color: #842029; word-break: break-all; font-size: 11px;">${w.url}</a>
        </li>`;
      });
      noticeHtml += `</ul></div>`;
    }

    let warningsHtml = "";
    if (hasAuditNotice) {
      warningsHtml = `
        <div style="background-color: #fff3cd; border: 1px solid #ffe69c; border-radius: 8px; padding: 15px; margin-bottom: 20px; color: #664d03;">
          <h3 style="margin: 0 0 10px 0; color: #664d03; font-size: 15px;">⚠️ ATTENTION REQUIRED</h3>
          ${noticeHtml}
        </div>
      `;
    }

    const userName = profileData.userName || "User";
    const dashboardUrl = `https://tbehman.github.io/virtue-extension/?fileId=${profileData.driveFileId}#key=${keyHex}`;

    let subject = `Virtue Report for ${userName}: All Clear`;
    if (hasAuditNotice) subject = `Virtue Report for ${userName}: Activity Needs Review`;
    if (isHandoff) subject = `Virtue Report for ${userName}: Closing Summary`;
    if (isWelcome) subject = `Welcome! You are now an Accountability Partner for ${userName}`;

    let welcomeHeaderHtml = "";
    if (isWelcome) {
      welcomeHeaderHtml = `
        <div style="background-color: #f1f8f5; border-left: 4px solid #198754; padding: 16px; margin-bottom: 20px; border-radius: 4px;">
          <p style="margin: 0 0 8px 0; font-size: 15px; font-weight: bold; color: #0f5132;">
            Thank you for stepping up to support ${userName}!
          </p>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #146c43; line-height: 1.5;">
            ${userName} has selected you as a trusted accountability partner in the pursuit of digital integrity.
          </p>
        </div>
      `;
    }

    const domainCounts = {};
    currentWeekLogs.forEach(l => {
      try {
        if (l.url && l.url.startsWith("http")) {
          const domain = new URL(l.url).hostname.replace('www.', '');
          domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        }
      } catch (e) {}
    });
    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

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
            <strong>"${s.q || s.searchQuery}"</strong> 
            <span style="color: #6c757d; font-size: 11px;">(${new Date(s.t || s.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })})</span>
          </li>
        `).join('')
      : `<li style="font-size: 13px; color: #6c757d;">No search queries recorded</li>`;

    const footerLinkHtml = isHandoff ? `
      <div style="background-color: #e9ecef; padding: 12px; border-radius: 6px; text-align: center; font-size: 12px; color: #495057;">
        <em>This is a final closing snapshot. Live web report access for this account has ended.</em>
      </div>
    ` : `
      <div style="text-align: center; border-top: 1px solid #e9ecef; padding-top: 20px; margin-top: 20px;">
        <a href="${dashboardUrl}" target="_blank" style="background-color: #198754; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">View Live Web Dashboard ➔</a>
      </div>
    `;

    const bodyHtml = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e9ecef; overflow: hidden; padding: 25px;">
          <h2 style="color: #198754; font-size: 22px;">Virtue Accountability Report</h2>
          ${welcomeHeaderHtml}
          ${warningsHtml}
          <table style="width: 100%; border-collapse: separate; border-spacing: 10px; margin-bottom: 25px;">
            <tr>
              <td style="width: 33%; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 14px; text-align: center;">
                <div style="font-size: 10px; color: #6c757d; font-weight: 700; text-transform: uppercase;">Sites Visited</div>
                <div style="font-size: 22px; font-weight: 800; color: #212529; margin-top: 4px;">${currentSitesCount}</div>
                ${trendHtml}
              </td>
              <td style="width: 33%; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 14px; text-align: center;">
                <div style="font-size: 10px; color: #6c757d; font-weight: 700; text-transform: uppercase;">Peak Hours</div>
                <div style="font-size: 14px; font-weight: 800; color: #212529; margin-top: 8px;">${peakHoursStr}</div>
              </td>
              <td style="width: 33%; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 14px; text-align: center;">
                <div style="font-size: 10px; color: #6c757d; font-weight: 700; text-transform: uppercase;">Searches</div>
                <div style="font-size: 22px; font-weight: 800; color: #198754; margin-top: 4px;">${validSearches.length}</div>
              </td>
            </tr>
          </table>
          <h3 style="font-size: 15px; color: #212529; margin-bottom: 10px;">Top Visited Domains</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">${domainRowsHtml}</table>
          <h3 style="font-size: 15px; color: #212529; margin-bottom: 10px;">Recent Web Searches</h3>
          <ul style="padding-left: 20px; margin-bottom: 25px;">${searchRowsHtml}</ul>
          ${footerLinkHtml}
        </div>
      </body>
      </html>
    `;

    return await sendGmailNotification({ toEmail: targetEmail, subject: subject, bodyHtml: bodyHtml });
  } catch (err) {
    console.error("Report snapshot dispatch error:", err);
    return false;
  }
}

// ==========================================
// 3. ID-ANCHORED ROOT SYNC ENGINE & AUTO-DISCOVERY
// ==========================================
async function findAndValidateExistingDriveFile(token) {
  try {
    const query = encodeURIComponent(`name = '${VIRTUE_CONFIG.FILE_NAME}' and trashed = false`);
    const res = await fetchWithBackoff(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,createdTime)`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const files = data.files || [];
    
    if (files.length === 0) return null;

    // Sort by newest first if multiple files exist
    files.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

    // Test decryption for candidate files to ensure cryptographic ownership
    const { key } = await getActiveEncryptionKey();

    for (const file of files) {
      try {
        const fileRes = await authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        if (!fileRes.ok) continue;
        const fileData = await fileRes.json();

        // Verify we can successfully decrypt it with our current PIN/email key
        if (fileData.encryptedData && fileData.iv) {
          await decryptData(fileData.encryptedData, fileData.iv, key);
        }
        
        console.log(`🔐 Successfully validated and decrypted existing vault file: ${file.id}`);
        return file.id;
      } catch (decErr) {
        console.warn(`⚠️ Found file ${file.id} in Drive, but decryption failed (wrong PIN/email or incompatible data). Skipping...`);
      }
    }
  } catch (err) {
    console.warn("Drive search & validation exception:", err);
  }
  return null;
}

function flushBufferToDriveJson() {
  if (isNonChromeChromium) return;
  chrome.storage.local.get({ logBuffer: [], driveFileId: "" }, async (res) => {
    const buffer = res.logBuffer;
    if (buffer.length === 0) return;

    let fileId = res.driveFileId;
    try {
      if (!fileId) {
        await new Promise((resolve, reject) => {
          fetchNewToken(false, async (token) => {
            try {
              // 1. AUTO-DISCOVERY & CRYPTOGRAPHIC VALIDATION
              fileId = await findAndValidateExistingDriveFile(token);
              
              if (fileId) {
                await chrome.storage.local.set({ driveFileId: fileId });
                console.log(`🔗 Adopted validated Google Drive vault file ID: ${fileId}`);
              } else {
                // 2. Fallback: Create a brand new file ONLY if no valid decrypted file exists
                fileId = await createBrandNewRootDriveFile(token);
              }
              resolve();
            } catch (err) { reject(err); }
          }, reject);
        });
      }
      await performDriveUploadCycle(fileId, buffer);
    } catch (err) {
      if (err.message && (err.message.includes("404") || err.message.includes("403"))) {
        await chrome.storage.local.remove(["driveFileId"]);
        try {
          await new Promise((resolve, reject) => {
            fetchNewToken(false, async (token) => {
              try {
                // Re-attempt auto-discovery before creating a fresh one during 404 recovery
                let recoveredFileId = await findAndValidateExistingDriveFile(token);
                if (!recoveredFileId) {
                  recoveredFileId = await createBrandNewRootDriveFile(token);
                  await notifyPartnerLogReset(recoveredFileId, buffer);
                } else {
                  await chrome.storage.local.set({ driveFileId: recoveredFileId });
                }
                await performDriveUploadCycle(recoveredFileId, buffer);
                resolve();
              } catch (e) { reject(e); }
            }, reject);
          });
        } catch (innerErr) {
          console.error("❌ Failed to recover and sync after file removal:", innerErr);
        }
      }
    }
  });
}

async function notifyPartnerLogReset(newFileId, buffer) {
  const profile = await new Promise(r => chrome.storage.local.get(["userName", "partnerEmail", "partnerName"], r));
  if (!profile.partnerEmail) return;

  const { keyHex } = await getActiveEncryptionKey();
  const dashboardUrl = `https://tbehman.github.io/virtue-extension/?fileId=${newFileId}#key=${keyHex}`;
  const userName = profile.userName || "User";
  const subject = `Notice & New Link: Virtue Tracking Vault Reset for ${userName}`;

  const bodyHtml = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e9ecef; overflow: hidden; padding: 25px;">
        <h2 style="color: #d97706; font-size: 20px; margin-top: 0;">Virtue Vault Reset Notice</h2>
        <p style="font-size: 14px; color: #212529; line-height: 1.5;">
          Hello ${profile.partnerName || "Partner"}, a brand new tracking vault has been automatically provisioned for <strong>${userName}</strong>.
        </p>
        <div style="text-align: center; border-top: 1px solid #e9ecef; padding-top: 20px; margin-top: 20px;">
          <a href="${dashboardUrl}" target="_blank" style="background-color: #198754; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">View New Live Web Dashboard ➔</a>
        </div>
      </div>
    </body>
    </html>
  `;
  await sendGmailNotification({ toEmail: profile.partnerEmail, subject, bodyHtml });
}

async function createBrandNewRootDriveFile(token) {
  const createRes = await fetchWithBackoff("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: VIRTUE_CONFIG.FILE_NAME, mimeType: VIRTUE_CONFIG.MIME_FILE })
  });

  if (!createRes.ok) throw new Error(`Vault file creation failed with status ${createRes.status}`);
  const fileJson = await createRes.json();
  const newFileId = fileJson.id;
  await chrome.storage.local.set({ driveFileId: newFileId });

  const profile = await new Promise(r => chrome.storage.local.get([
    "userName", "partnerName", "partnerEmail", "userEmail", 
    "customBlocklist", "customApprovedList", "customKeywords", "filterMode"
  ], r));

  const initialPayload = {
    metadata: {
      version: "1.0",
      userName: profile.userName || "",
      partnerName: profile.partnerName || "",
      partnerEmail: profile.partnerEmail || "",
      userEmail: profile.userEmail || "",
      customBlocklist: profile.customBlocklist || [],
      customApprovedList: profile.customApprovedList || [],
      customKeywords: profile.customKeywords || [],
      filterMode: profile.filterMode || FILTER_MODE_STANDARD,
      settingsLastUpdated: Date.now(),
      lastUpdated: new Date().toISOString()
    },
    iv: "",
    encryptedData: ""
  };

  await fetchWithBackoff(`https://www.googleapis.com/upload/drive/v3/files/${newFileId}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(initialPayload)
  });

  if (profile.partnerEmail) {
    await authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${newFileId}/permissions?sendNotificationEmail=false`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "user", emailAddress: profile.partnerEmail })
      }
    );
    await dispatchReportSnapshot({
      userName: profile.userName, partnerName: profile.partnerName, partnerEmail: profile.partnerEmail, driveFileId: newFileId
    }, { isWelcome: true, targetEmail: profile.partnerEmail });
  }

  return newFileId;
}

async function performDriveUploadCycle(fileId, newLogs) {
  const res = await fetchWithBackoff(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { "Cache-Control": "no-cache" }
  });

  if (!res.ok) throw new Error(`Drive fetch failed with status ${res.status}`);

  const etag = res.headers.get("ETag");
  let fileData = { metadata: { version: "1.0" } };
  let existingLogs = [];
  const { key } = await getActiveEncryptionKey();

  try {
    fileData = await res.json();
    if (fileData.encryptedData && fileData.iv) {
      existingLogs = await decryptData(fileData.encryptedData, fileData.iv, key);
    }
  } catch (e) {}

  const localProfile = await new Promise(r => chrome.storage.local.get([
    "userName", "partnerName", "partnerEmail", "userEmail", 
    "customBlocklist", "customApprovedList", "customKeywords", "filterMode", "settingsLastUpdated"
  ], r));

  const logMap = new Map();
  [...existingLogs, ...newLogs].forEach(log => {
    const timestamp = log.t || log.timestamp;
    logMap.set(`${timestamp}_${log.url || log.type || ''}`, log);
  });
  const combined = Array.from(logMap.values());
  const cutoffTime = Date.now() - SEVEN_DAYS_MS;
  const rollingLogs = combined.filter(log => {
    const logTime = log.t || new Date(log.timestamp).getTime();
    return !isNaN(logTime) && logTime > cutoffTime;
  });

  const encrypted = await encryptData(rollingLogs, key);
  const driveMeta = fileData.metadata || {};
  const updatedPayload = {
    metadata: {
      ...driveMeta,
      version: "1.0",
      userName: localProfile.userName || driveMeta.userName || "",
      partnerName: localProfile.partnerName || driveMeta.partnerName || "",
      partnerEmail: localProfile.partnerEmail || driveMeta.partnerEmail || "",
      userEmail: localProfile.userEmail || driveMeta.userEmail || "",
      settingsLastUpdated: localProfile.settingsLastUpdated || driveMeta.settingsLastUpdated || Date.now(),
      lastUpdated: new Date().toISOString()
    },
    iv: encrypted.iv,
    encryptedData: encrypted.ciphertext
  };

  const uploadHeaders = { "Content-Type": "application/json" };
  if (etag) uploadHeaders["If-Match"] = etag;

  const uploadRes = await fetchWithBackoff(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: uploadHeaders,
    body: JSON.stringify(updatedPayload)
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Drive PATCH failed [Status ${uploadRes.status}]: ${errText}`);
  }

  await chrome.storage.local.set({ logBuffer: [], syncFailCount: 0 });
}

// ==========================================
// 4. HIGH-PERFORMANCE INTERCEPTION ENGINE (ABSOLUTE PRECEDENCE RULES)
// ==========================================
if (!isNonChromeChromium) {
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return; 
    const urlStr = details.url;
    if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) return;
    if (urlStr.includes("virtue_bypass=true")) return;

    chrome.storage.local.get({ 
      filterMode: FILTER_MODE_STANDARD, 
      customBlocklist: [], 
      customApprovedList: [], 
      customKeywords: [] 
    }, (settings) => {
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

        const currentMode = settings.filterMode || FILTER_MODE_STANDARD;
        const isStrict = currentMode === FILTER_MODE_STRICT;
        const approvedList = settings.customApprovedList || [];

        // 1. ABSOLUTE PRECEDENCE: Check Approved List first (Approved list always wins!)
        const isApproved = matchesCustomList(approvedList);

        if (isApproved) {
          shouldBlock = false; // Bypass all blocking immediately
        } else if (isStrict) {
          shouldBlock = true;  // Strict mode: block everything not explicitly approved
        } else {
          // Standard Mode evaluation
          const inCustomBlocklist = matchesCustomList(settings.customBlocklist || []);

          let inStaticShield = false;
          const parts = hostname.split('.');
          for (let i = 0; i < parts.length - 1; i++) {
            const rootDomain = parts.slice(i).join('.');
            if (DEFAULT_BLOCKLIST.has(rootDomain)) {
              inStaticShield = true;
              break;
            }
          }

          shouldBlock = inCustomBlocklist || inStaticShield || isYahooMediaLeak;

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
}

// ==========================================
// 5. GENERAL NAVIGATION LOGGING
// ==========================================
function processNavigation(url, tabId) {
  if (isNonChromeChromium) return;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (url.includes(chrome.runtime.id) && url.includes("blocked.html")) return;

  chrome.tabs.get(tabId).then((tab) => {
    if (!tab) return;

    let title = tab.title || "";
    const searchQuery = extractSearchQuery(url);

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
    let isBypassed = false;

    if (url.includes("virtue_bypass=true")) {
      finalUrl = url.replace(/[?&]virtue_bypass=true/, "");
      title = `[VISITED] ${title}`;
      isBypassed = true;
    }

    addToBuffer({
      t: Date.now(),
      type: "PAGE_VISIT",
      title: title ? title.slice(0, 150) : "Untitled Page",
      url: finalUrl ? finalUrl.slice(0, 500) : "",
      q: searchQuery ? searchQuery.trim() : "",
      flag: isBypassed ? 1 : 0,
      device: getDeviceInfo()
    });
  }).catch(() => {});
}

if (!isNonChromeChromium) {
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    processNavigation(details.url, details.tabId);
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    processNavigation(details.url, details.tabId);
  });
}

// ==========================================
// 6. MESSAGE LISTENERS
// ==========================================
if (!isNonChromeChromium) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateProfile" || request.type === "UPDATE_PROFILE") {
      const newProfile = request.profileData || request.profile || {};
      const oldEmail = (request.oldPartnerEmail || "").trim().toLowerCase();
      const newEmail = (newProfile.partnerEmail || "").trim().toLowerCase();

      (async () => {
        const deviceId = await getDeviceId();
        await chrome.storage.local.set({
          ...newProfile,
          oldPartnerEmail: oldEmail,
          syncStatus: "PENDING_SYNC",
          syncRetryCount: 0,
          lastInitiatorDeviceId: deviceId
        });
        reconcilePartnerPermissions();
      })();

      sendResponse({ success: true });
      return false;
    }

    if (request.type === "TRIGGER_INTERACTIVE_AUTH") {
      fetchNewToken(true, (token) => {
        clearAuthFailureBanner();
        flushBufferToDriveJson();
      }, (err) => { console.error("Interactive auth failed:", err); });
      return true;
    }

    if (request.type === "SEND_TEST_REPORT") {
      chrome.storage.local.get(["userName", "partnerName", "partnerEmail", "driveFileId"], async (profile) => {
        if (!profile.partnerEmail || !profile.driveFileId) {
          sendResponse({ success: false, error: "Missing partner configuration" });
          return;
        }
        const success = await dispatchReportSnapshot(profile, { isHandoff: false });
        sendResponse({ success });
      });
      return true;
    }

    if (request.type === "RECOVER_USER_PIN") {
      chrome.storage.local.get(["userPin", "userName", "userEmail"], (data) => {
        const targetEmail = data.userEmail;
        if (!targetEmail) {
          sendResponse({ success: false, error: "No user email found" });
          return;
        }
        const userPin = data.userPin || "1234";
        const userName = data.userName || "Friend";
        const subject = "Your Virtue PIN Recovery";
        const bodyHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #198754; margin-top: 0;">Virtue Security Recovery</h2>
            <p>Hello ${userName},</p>
            <p>You requested recovery for your 4-digit Virtue security PIN:</p>
            <div style="background-color: #f1f5f9; padding: 15px; font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; border-radius: 8px; color: #0f172a; margin: 20px 0;">
              ${userPin}
            </div>
          </div>
        `;
        sendGmailNotification({ toEmail: targetEmail, subject, bodyHtml }).then(success => sendResponse({ success }));
      });
      return true;
    }

    if (request.type === "SEND_PARTNER_HANDOFF_EMAIL") {
      chrome.storage.local.get(["userName", "partnerName", "partnerEmail", "driveFileId"], async (profile) => {
        if (!profile.driveFileId) {
          sendResponse({ success: false });
          return;
        }
        if (request.oldEmail) {
          await dispatchReportSnapshot(profile, { isHandoff: true, targetEmail: request.oldEmail });
        }
        reconcilePartnerPermissions();
        sendResponse({ success: true });
      });
      return true;
    }

    if (request.type === "SWITCH_GOOGLE_ACCOUNT") {
      flushBufferToDriveJson();
      chrome.storage.local.get(["userName", "partnerName", "partnerEmail", "driveFileId", "authToken"], async (profile) => {
        if (profile.partnerEmail && profile.driveFileId) {
          await dispatchReportSnapshot(profile, { isHandoff: true, targetEmail: profile.partnerEmail });
        }
        const token = profile.authToken;
        if (token) {
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
            .finally(() => {
              const clearStorageAndRespond = () => {
                chrome.storage.local.remove(["authToken", "refreshToken", "driveFileId", "virtueFolderId", "userEmail"], () => {
                  sendResponse({ success: true });
                });
              };
              chrome.identity.removeCachedAuthToken({ token }, clearStorageAndRespond);
            });
        } else {
          chrome.storage.local.remove(["authToken", "refreshToken", "driveFileId", "virtueFolderId", "userEmail"], () => {
            sendResponse({ success: true });
          });
        }
      });
      return true;
    }
  });
}

// ==========================================
// 7. EXPOSE HELPERS FOR DEVTOOLS CONSOLE TESTING
// ==========================================
globalThis.authenticatedFetch = authenticatedFetch;
globalThis.dispatchReportSnapshot = dispatchReportSnapshot;
globalThis.checkAndSendWeeklyReport = checkAndSendWeeklyReport;
globalThis.flushBufferToDriveJson = flushBufferToDriveJson;
globalThis.reconcilePartnerPermissions = reconcilePartnerPermissions;
globalThis.createBrandNewRootDriveFile = createBrandNewRootDriveFile;
globalThis.fetchWithBackoff = fetchWithBackoff;
globalThis.findAndValidateExistingDriveFile = findAndValidateExistingDriveFile;