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

// ==========================================
// 1. AUTHENTICATION & TOKEN MANAGERS
// ==========================================
function getValidAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["authToken"], (res) => {
      if (res.authToken) {
        chrome.identity.removeCachedAuthToken({ token: res.authToken }, () => {
          chrome.identity.getAuthToken({ interactive }, (newToken) => {
            if (chrome.runtime.lastError || !newToken) return reject(chrome.runtime.lastError);
            chrome.storage.local.set({ authToken: newToken }, () => resolve(newToken));
          });
        });
      } else {
        chrome.identity.getAuthToken({ interactive }, (newToken) => {
          if (chrome.runtime.lastError || !newToken) return reject(chrome.runtime.lastError);
          chrome.storage.local.set({ authToken: newToken }, () => resolve(newToken));
        });
      }
    });
  });
}

async function authenticatedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["authToken"], async (res) => {
      let token = res.authToken;

      if (!token) {
        try { token = await getValidAuthToken(false); } 
        catch (e) { return reject("No valid authorization token available."); }
      }

      options.headers = {
        ...options.headers,
        "Authorization": `Bearer ${token}`
      };

      try {
        let response = await fetch(url, options);

        if (response.status === 401) {
          console.warn("401 Unauthorized detected. Silently refreshing token...");
          const newToken = await getValidAuthToken(false);
          options.headers["Authorization"] = `Bearer ${newToken}`;
          response = await fetch(url, options);
        }

        resolve(response);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ==========================================
// 2. INITIALIZE ALARMS & RULES
// ==========================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("flushBuffer", { periodInMinutes: 1 });

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
  if (alarm.name === "flushBuffer") { flushBufferToDriveJson(); }
});

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

    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      if (!isAllowed) {
        uniqueLogs.unshift({
          url: "[ALERT] Incognito Tracking is DISABLED in settings!",
          title: "[ALERT] Incognito Tracking is DISABLED in settings!",
          searchQuery: "N/A",
          device: getDeviceInfo(),
          timestamp: getCleanTimestamp(),
          flagged: true
        });
      }

      if (!driveFileId) {
        findOrCreateDriveJsonFile((fileId) => {
          syncLogsToDriveFile(fileId, uniqueLogs);
        });
      } else {
        syncLogsToDriveFile(driveFileId, uniqueLogs);
      }
    });
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
        chrome.storage.local.set({ driveFileId: fileId }, () => callback(fileId));
      } else {
        // Create new virtue_logs.json file
        const metadata = {
          name: "virtue_logs.json",
          mimeType: "application/json"
        };
        const initialContent = JSON.stringify({ metadata: { version: "1.0" }, logs: [] });

        authenticatedFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          headers: { "Content-Type": "multipart/related; boundary=virtue_boundary" },
          body: `--virtue_boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--virtue_boundary\r\nContent-Type: application/json\r\n\r\n${initialContent}\r\n--virtue_boundary--`
        })
        .then(res => res.json())
        .then(newFile => {
          chrome.storage.local.set({ driveFileId: newFile.id }, () => callback(newFile.id));
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

    const existingLogs = fileData.logs || [];
    const combined = [...existingLogs, ...newLogs];

    // Filter to rolling 7-day window
    const cutoffTime = Date.now() - SEVEN_DAYS_MS;
    const rollingLogs = combined.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return !isNaN(logTime) && logTime > cutoffTime;
    });

    fileData.logs = rollingLogs;
    fileData.metadata.lastUpdated = getCleanTimestamp();

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
  })
  .catch(err => {
    // If file was trashed/deleted, clear file pointer and retry next cycle
    console.warn("Drive file missing or inaccessible:", err);
    chrome.storage.local.remove(["driveFileId"]);
  });
}

// ==========================================
// 4. DYNAMIC INTERCEPTION ENGINE
// ==========================================
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; 
  const urlStr = details.url;
  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) return;
  if (urlStr.includes("virtue_bypass=true")) return;

  chrome.storage.local.get({ filterMode: "blocklist", customBlacklist: [], customWhitelist: [] }, (settings) => {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase();
      const isYahooMediaLeak = hostname.startsWith("images.search.yahoo.com") || hostname.startsWith("video.search.yahoo.com");

      let shouldBlock = false;

      if (settings.filterMode === "whitelist") {
        const inWhitelist = settings.customWhitelist.some(domain => {
          const cleanDomain = domain.toLowerCase().trim();
          return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
        });
        shouldBlock = !inWhitelist;
      } else {
        const inCustomBlacklist = settings.customBlacklist.some(domain => {
          const cleanDomain = domain.toLowerCase().trim();
          return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
        });

        const inStaticShield = DEFAULT_BLOCKLIST.some(domain => {
          const cleanDomain = domain.toLowerCase().trim();
          return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
        });

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