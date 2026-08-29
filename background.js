import { DEFAULT_BLOCKLIST } from './defaultBlocklist.js';

const SAFESEARCH_RULE_IDS = [101, 102, 103];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ==========================================
// 0. UTILITIES & DEVICE IDENTIFICATION
// ==========================================
function getCleanTimestamp() {
  return new Date().toISOString(); // ISO string for easy date comparison across devices
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = "Desktop";
  
  if (ua.includes("Win")) os = "Windows PC";
  else if (ua.includes("Mac")) os = "Macbook";
  else if (ua.includes("Android")) os = "Android Phone";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS Device";

  return `${os} (Chrome)`;
}

// Automatically update Drive permissions so GitHub Pages dashboard can read the file
function makeFileUnlisted(fileId) {
  authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "reader",
      type: "anyone"
    })
  })
  .then(res => res.json())
  .then(data => console.log("Drive file permissions automatically set to Anyone with link:", data))
  .catch(err => console.error("Error setting Drive file permissions:", err));
}

// Helper: Safely Base64 encode UTF-8 strings for Gmail API
function base64EncodeUtf8(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode('0x' + p1);
  }))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
}

// ==========================================
// 1. AUTHENTICATION & TOKEN MANAGERS
// ==========================================
function getValidAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["authToken"], (res) => {
      const oldToken = res.authToken;

      if (oldToken) {
        chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
          chrome.storage.local.remove(["authToken"], () => {
            fetchNewToken(interactive, resolve, reject);
          });
        });
      } else {
        fetchNewToken(interactive, resolve, reject);
      }
    });
  });
}

function fetchNewToken(interactive, resolve, reject) {
  chrome.identity.getAuthToken({ interactive }, (newToken) => {
    if (chrome.runtime.lastError || !newToken) {
      return reject(chrome.runtime.lastError || "Failed to retrieve token");
    }
    chrome.storage.local.set({ authToken: newToken }, () => resolve(newToken));
  });
}

async function authenticatedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["authToken"], async (res) => {
      let token = res.authToken;

      if (!token) {
        try { 
          token = await getValidAuthToken(false); 
        } catch (e) { 
          return reject("No valid authorization token available."); 
        }
      }

      options.headers = {
        ...options.headers,
        "Authorization": `Bearer ${token}`
      };

      try {
        let response = await fetch(url, options);

        if (response.status === 401) {
          console.warn("401 Unauthorized detected. Clearing cached token and attempting silent refresh...");
          try {
            const newToken = await getValidAuthToken(false);
            options.headers["Authorization"] = `Bearer ${newToken}`;
            response = await fetch(url, options);
          } catch (refreshErr) {
            console.error("Silent token refresh failed. User must re-authenticate via extension popup.");
            return reject(refreshErr);
          }
        }

        resolve(response);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ==========================================
// 1.1 GMAIL API DISPATCHER HELPER (HTML & UTF-8)
// ==========================================
async function sendGmailNotification({ toEmail, subject, bodyHtml, bodyText }) {
  if (!toEmail) return;

  // UTF-8 RFC 2047 MIME Header Encoding for clean email subjects
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
      console.error("Gmail API dispatch failed with status:", res.status);
    }
  } catch (err) {
    console.error("Error sending email via Gmail API:", err);
  }
}

// ==========================================
// 2. INITIALIZE ALARMS & RULES
// ==========================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("flushBuffer", { periodInMinutes: 1 });
  chrome.alarms.create("checkWeeklyDigest", { periodInMinutes: 1440 }); // Daily check for 7-day threshold

  chrome.storage.local.get(["filterMode", "customBlacklist", "customWhitelist"], (result) => {
    const updates = {};
    if (!result.filterMode) updates.filterMode = "blocklist";
    if (!result.customBlacklist) updates.customBlacklist = ["facebook.com", "instagram.com"];
    if (!result.customWhitelist) updates.customWhitelist = ["wikipedia.org", "google.com"];

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

function extractSearchQuery(urlStr) {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname;
    if ((domain.includes("google.com") && url.pathname.includes("/search")) ||
        (domain.includes("bing.com") && url.pathname.includes("/search")) ||
        (domain.includes("duckduckgo.com") && url.pathname === "/")) {
      const queryParam = url.searchParams.get("q");
      if (queryParam) return decodeURIComponent(queryParam.replace(/\+/g, " "));
    }
  } catch (e) { console.error("URL Parse error:", e); }
  return null;
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
    "userName",
    "partnerName",
    "partnerEmail",
    "driveFileId",
    "lastWeeklyDigestSentAt"
  ], async (data) => {
    if (!data.partnerEmail || !data.driveFileId) return;

    const now = Date.now();
    const lastSent = data.lastWeeklyDigestSentAt || 0;

    if (now - lastSent < SEVEN_DAYS_MS) return;

    try {
      const res = await authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${data.driveFileId}?alt=media`);
      const fileData = await res.json();
      const logs = fileData.logs || [];

      // Process Metrics
      const validSearches = logs.filter(l => l.searchQuery && l.searchQuery.trim() !== "" && l.searchQuery.trim().toUpperCase() !== "N/A");
      const ignoredWarnings = logs.filter(l => (l.title && l.title.includes("[VISITED]")) || (l.url && l.url.includes("virtue_bypass=true")));

      // Top Domains
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

      const userName = data.userName || "User";
      const partnerName = data.partnerName || "Partner";
      const dashboardUrl = `https://tbehman.github.io/virtue-extension/?fileId=${data.driveFileId}`;

      // Build HTML Email Body
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
            
            <!-- Header with Lion Logo -->
            <div style="display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #198754; padding-bottom: 15px; margin-bottom: 20px;">
              <img src="https://raw.githubusercontent.com/tbehman/virtue-extension/main/docs/virtue_logo.png" alt="Virtue Logo" style="height: 48px; width: auto; vertical-align: middle;">
              <h2 style="margin: 0; color: #198754; font-size: 22px;">Virtue Weekly Digest</h2>
            </div>

            <p style="font-size: 14px; color: #212529;">Hello ${partnerName},</p>
            <p style="font-size: 14px; color: #6c757d; line-height: 1.5;">Here is the 7-day accountability snapshot report for <strong>${userName}</strong>.</p>

            ${warningsHtml}

            <!-- 3 Summary Metrics -->
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

            <!-- Top Domains Table -->
            <h3 style="font-size: 15px; color: #212529; margin-bottom: 10px;">📊 Top Visited Domains</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
              ${domainRowsHtml}
            </table>

            <!-- Recent Searches List -->
            <h3 style="font-size: 15px; color: #212529; margin-bottom: 10px;">🔍 Recent Search Queries</h3>
            <ul style="padding-left: 20px; margin-bottom: 25px;">
              ${searchRowsHtml}
            </ul>

            <!-- CTA Live Dashboard Button & Link -->
            <div style="text-align: center; border-top: 1px solid #e9ecef; padding-top: 20px; margin-top: 20px;">
              <a href="${dashboardUrl}" target="_blank" style="background-color: #198754; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">View Full Web Dashboard ➔</a>
              <p style="margin-top: 12px; font-size: 11px; color: #6c757d;">Direct Link: <a href="${dashboardUrl}" style="color: #1a73e8;">${dashboardUrl}</a></p>
            </div>

            <p style="font-size: 12px; color: #6c757d; text-align: center; margin-top: 25px;">Blessings,<br><strong>Virtue Accountability Team</strong></p>
          </div>
        </body>
        </html>
      `;

      const subject = `🛡️ Virtue Weekly Accountability Digest for ${userName}`;

      await sendGmailNotification({
        toEmail: data.partnerEmail,
        subject: subject,
        bodyHtml: bodyHtml
      });

      chrome.storage.local.set({ lastWeeklyDigestSentAt: now });
    } catch (err) {
      console.error("Weekly digest generation error:", err);
    }
  });
}

// ==========================================
// 3. DRIVE JSON SYNC ENGINE (ROLLING 7-DAYS)
// ==========================================
function flushBufferToDriveJson() {
  chrome.storage.local.get({ logBuffer: [], driveFileId: "" }, (result) => {
    const buffer = result.logBuffer;
    let driveFileId = result.driveFileId;

    if (buffer.length === 0) return;

    // Deduplicate current buffer entries by URL
    let uniqueLogs = Array.from(new Set(buffer.map(a => a.url))).map(url => buffer.find(a => a.url === url));

    if (!driveFileId) {
      findOrCreateDriveJsonFile((fileId) => {
        syncLogsToDriveFile(fileId, uniqueLogs);
      });
    } else {
      syncLogsToDriveFile(driveFileId, uniqueLogs);
    }
  });
}

function findOrCreateDriveJsonFile(callback) {
  // Search Drive for existing virtue_logs.json file
  const query = encodeURIComponent("name = 'virtue_logs.json' and trashed = false");
  authenticatedFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`)
    .then(res => res.json())
    .then(data => {
      if (data.files && data.files.length > 0) {
        const fileId = data.files[0].id;
        makeFileUnlisted(fileId); // Ensure permissions are open
        chrome.storage.local.set({ driveFileId: fileId }, () => callback(fileId));
      } else {
        // Create new virtue_logs.json file with local profile metadata
        chrome.storage.local.get(["userName", "partnerName", "partnerEmail"], (profile) => {
          const metadata = {
            name: "virtue_logs.json",
            mimeType: "application/json"
          };
          const initialContent = JSON.stringify({
            metadata: {
              version: "1.0",
              userName: profile.userName || "",
              partnerName: profile.partnerName || "",
              partnerEmail: profile.partnerEmail || ""
            },
            logs: []
          });

          authenticatedFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
            method: "POST",
            headers: { "Content-Type": "multipart/related; boundary=virtue_boundary" },
            body: `--virtue_boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--virtue_boundary\r\nContent-Type: application/json\r\n\r\n${initialContent}\r\n--virtue_boundary--`
          })
          .then(res => res.json())
          .then(newFile => {
            makeFileUnlisted(newFile.id); // Automatically set unlisted permissions on creation
            chrome.storage.local.set({ driveFileId: newFile.id }, () => callback(newFile.id));
          });
        });
      }
    })
    .catch(err => console.error("Error finding/creating Drive file:", err));
}

function syncLogsToDriveFile(fileId, newLogs) {
  // Fetch existing logs and version ETag
  authenticatedFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { "Cache-Control": "no-cache" }
  })
  .then(async (res) => {
    const etag = res.headers.get("ETag");
    let fileData = { metadata: { version: "1.0" }, logs: [] };

    try {
      fileData = await res.json();
    } catch (e) {
      console.warn("Could not parse existing Drive JSON; initializing fresh object.");
    }

    chrome.storage.local.get(["userName", "partnerName", "partnerEmail"], (localProfile) => {
      const existingLogs = fileData.logs || [];
      const combined = [...existingLogs, ...newLogs];

      // Filter to rolling 7-day window
      const cutoffTime = Date.now() - SEVEN_DAYS_MS;
      const rollingLogs = combined.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        return !isNaN(logTime) && logTime > cutoffTime;
      });

      fileData.logs = rollingLogs;

      // Preserve & Pull Drive Metadata down to Local Storage if local is empty (Secondary Device Flow)
      const driveMeta = fileData.metadata || {};
      const profileUpdates = {};

      if (!localProfile.userName && driveMeta.userName) profileUpdates.userName = driveMeta.userName;
      if (!localProfile.partnerName && driveMeta.partnerName) profileUpdates.partnerName = driveMeta.partnerName;
      if (!localProfile.partnerEmail && driveMeta.partnerEmail) profileUpdates.partnerEmail = driveMeta.partnerEmail;

      if (Object.keys(profileUpdates).length > 0) {
        chrome.storage.local.set(profileUpdates);
      }

      // Update Drive Metadata with latest profile info
      fileData.metadata = {
        ...driveMeta,
        version: "1.0",
        userName: localProfile.userName || driveMeta.userName || "",
        partnerName: localProfile.partnerName || driveMeta.partnerName || "",
        partnerEmail: localProfile.partnerEmail || driveMeta.partnerEmail || "",
        lastUpdated: getCleanTimestamp()
      };

      // Upload updated JSON with ETag check to prevent multi-device race conditions
      const uploadHeaders = { "Content-Type": "application/json" };
      if (etag) uploadHeaders["If-Match"] = etag;

      authenticatedFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: uploadHeaders,
        body: JSON.stringify(fileData, null, 2)
      })
      .then(uploadRes => {
        if (uploadRes.status === 412) {
          // Precondition Failed: Another device updated the file. Retry sync!
          console.warn("ETag conflict detected. Retrying sync loop...");
          setTimeout(() => syncLogsToDriveFile(fileId, newLogs), 500);
        } else if (uploadRes.ok) {
          // Success! Clear local buffer
          chrome.storage.local.set({ logBuffer: [] });
        }
      })
      .catch(err => console.error("Upload error:", err));
    });
  })
  .catch(err => {
    // If file was trashed/deleted, clear file pointer and retry next cycle
    console.warn("Drive file missing or inaccessible:", err);
    chrome.storage.local.remove(["driveFileId"]);
  });
}

// ==========================================
// 4. HIGH-PERFORMANCE INTERCEPTION ENGINE (O(1) LOOKUP)
// ==========================================
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; 
  const urlStr = details.url;
  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) return;
  if (urlStr.includes("virtue_bypass=true")) return;

  chrome.storage.local.get({ filterMode: "blocklist", customBlacklist: [], customWhitelist: [] }, (settings) => {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase().trim();
      const isYahooMediaLeak = hostname.startsWith("images.search.yahoo.com") || hostname.startsWith("video.search.yahoo.com");

      let shouldBlock = false;

      // Helper function for custom blacklist/whitelist matching
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

        // O(1) Constant-time check across 114,000+ DEFAULT_BLOCKLIST Set
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
      }

      if (shouldBlock) {
        const blockPageUrl = chrome.runtime.getURL(`blocked.html?target=${encodeURIComponent(urlStr)}`);
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

  chrome.tabs.get(tabId, (tab) => {
    let title = tab ? tab.title : "";
    const searchQuery = extractSearchQuery(url);
    const cleanLocalTime = getCleanTimestamp();

    if (tab && tab.incognito) { title = `[INCOGNITO] ${title}`; }
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
  });
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
// 6. MESSAGE LISTENERS FOR POPUP ACTIONS
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    }).then(() => sendResponse({ success: true }));
    return true; // Async response
  }

  if (request.type === "SWITCH_GOOGLE_ACCOUNT") {
    // 1. Flush local buffer to current Drive JSON
    flushBufferToDriveJson();

    // 2. Notify current partner of account disconnect
    chrome.storage.local.get(["userName", "partnerName", "partnerEmail"], (profile) => {
      if (profile.partnerEmail) {
        sendGmailNotification({
          toEmail: profile.partnerEmail,
          subject: "⚠️ Virtue Security Alert: Google Account Disconnected",
          bodyText: `Hello ${profile.partnerName || 'Partner'},\n\n` +
            `${profile.userName || 'User'} has unlinked their primary Google Account from Virtue. ` +
            `Protection logs will resume once re-authenticated.\n\n` +
            `Blessings,\nVirtue Security`
        });
      }

      // 3. Revoke current OAuth token and purge local storage pointers
      chrome.storage.local.get(["authToken"], (res) => {
        if (res.authToken) {
          chrome.identity.removeCachedAuthToken({ token: res.authToken }, () => {
            chrome.storage.local.remove(["authToken", "driveFileId"], () => {
              sendResponse({ success: true });
            });
          });
        } else {
          chrome.storage.local.remove(["authToken", "driveFileId"], () => {
            sendResponse({ success: true });
          });
        }
      });
    });
    return true; // Async response
  }
});