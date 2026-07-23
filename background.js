import { DEFAULT_BLOCKLIST } from './defaultBlocklist.js';

const SAFESEARCH_RULE_IDS = [101, 102, 103];

function getCleanTimestamp() {
  const options = { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true 
  };
  return new Date().toLocaleString('en-US', options); // e.g., "Sat, Jul 18, 1:58 AM"
}

function refreshAuthToken(callback) {
  chrome.storage.local.get(["authToken"], (res) => {
    if (res.authToken) {
      chrome.identity.removeCachedAuthToken({ token: res.authToken }, () => {
        chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
          if (chrome.runtime.lastError || !newToken) return;
          chrome.storage.local.set({ authToken: newToken }, () => {
            if (callback) callback(newToken);
          });
        });
      });
    } else {
      chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
        if (chrome.runtime.lastError || !newToken) return;
        chrome.storage.local.set({ authToken: newToken }, () => {
          if (callback) callback(newToken);
        });
      });
    }
  });
}

// ==========================================
// 1. INITIALIZE BACKGROUND ALARMS & SETTINGS
// ==========================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("flushBuffer", { periodInMinutes: 1 });
  chrome.alarms.create("weeklyPartnerReport", { periodInMinutes: 10080 });

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
  if (alarm.name === "flushBuffer") { flushBuffer(); } 
  else if (alarm.name === "weeklyPartnerReport") { triggerWeeklyEmailReport(); }
});

// ==========================================
// 2. DATA FLUSH & SMART SHEET RE-USE
// ==========================================
function flushBuffer() {
  chrome.storage.local.get({ logBuffer: [], authToken: "", spreadsheetId: "" }, (result) => {
    const buffer = result.logBuffer;
    const token = result.authToken;
    const sheetId = result.spreadsheetId;

    if (buffer.length === 0 || !token) return;

    let uniqueLogs = Array.from(new Set(buffer.map(a => a.url))).map(url => buffer.find(a => a.url === url));

    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      if (!isAllowed) {
        uniqueLogs.unshift({
          url: "[ALERT] Incognito Tracking is DISABLED in settings!",
          title: "[ALERT] Incognito Tracking is DISABLED in settings!",
          searchQuery: "N/A",
          timestamp: getCleanTimestamp()
        });
      }

      const rowsToAppend = uniqueLogs.map(log => [
        log.timestamp, 
        log.title || "Untitled Page", 
        log.url, 
        log.searchQuery || ""
      ]);

      if (!sheetId) {
        createNewAccountabilitySheet(token, rowsToAppend);
      } else {
        verifyAndAppendLogs(sheetId, token, rowsToAppend);
      }
    });
  });
}

function verifyAndAppendLogs(sheetId, token, rows) {
  // Check if existing spreadsheet is accessible in Google Drive
  fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}?fields=id,trashed`, {
    headers: { "Authorization": `Bearer ${token}` }
  })
  .then(res => {
    if (res.status === 401) {
      refreshAuthToken((newToken) => { verifyAndAppendLogs(sheetId, newToken, rows); });
      return null;
    }
    return res.json();
  })
  .then(file => {
    if (file && file.id && !file.trashed) {
      appendLogsToSpreadsheet(sheetId, token, rows);
    } else if (file) {
      // File missing or trashed -> generate fresh sheet
      chrome.storage.local.remove(["spreadsheetId", "dashboardPreviewUrl"], () => {
        createNewAccountabilitySheet(token, rows);
      });
    }
  })
  .catch(() => {
    appendLogsToSpreadsheet(sheetId, token, rows);
  });
}

// ==========================================
// 3. ACCOUNTABILITY SHEET MATRIX GENERATOR
// ==========================================
function createNewAccountabilitySheet(token, initialRows) {
  chrome.storage.local.get({ customBlacklist: ["facebook.com", "instagram.com"] }, (storedData) => {
    const escapedDomains = storedData.customBlacklist.map(d => d.replace(/\./g, '\\.'));
    const blocklistRegex = escapedDomains.length > 0 ? `.*(${escapedDomains.join('|')}).*` : `.*(facebook\\.com|instagram\\.com).*`;

    fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { title: "Virtue Accountability Dashboard Portal" },
        sheets: [
          { properties: { title: "📊 Overview & Status" } },
          { properties: { title: "📋 Activity Logs" } }
        ]
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.spreadsheetId) {
        const newSheetId = data.spreadsheetId;
        const webPreviewUrl = `https://docs.google.com/spreadsheets/d/${newSheetId}/preview`;

        chrome.storage.local.set({ spreadsheetId: newSheetId, dashboardPreviewUrl: webPreviewUrl }, () => {
          
          const seedUrl = `https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}/values/📊 Overview & Status!A1:N40?valueInputOption=USER_ENTERED`;
          const seedData = Array(40).fill(null).map(() => Array(14).fill(""));
          
          // Main Title Header
          seedData[1][3] = "Virtue Accountability Dashboard";
          
          // Section Titles (Row 4)
          seedData[3][0] = "🏆 Top 10 Most Frequented Domains";
          seedData[3][4] = "🚫 Blocklist Activity";
          
          // Sub-Headers (Row 5)
          seedData[4][0] = "Website Domain"; seedData[4][1] = "Visit Frequency";
          seedData[4][4] = "Time";           seedData[4][5] = "Page Context"; seedData[4][6] = "URL Block Target";
          
          // Formulas (Row 6)
          seedData[5][0] = `=ARRAYFORMULA(QUERY(LET(urls, FILTER('📋 Activity Logs'!C2:C, '📋 Activity Logs'!C2:C<>"", NOT(REGEXMATCH('📋 Activity Logs'!C2:C, "(?i)\\[ALERT\\]|blocked\\.html"))), domains, REGEXEXTRACT(urls, "https?://([^/]+)"), HYPERLINK(urls, domains)), "SELECT Col1, COUNT(Col1) GROUP BY Col1 ORDER BY COUNT(Col1) DESC LIMIT 10 LABEL Col1 '', COUNT(Col1) ''", 0))`;
          seedData[5][4] = `=QUERY('📋 Activity Logs'!A2:C, "SELECT A, B, C WHERE C CONTAINS '[BLOCKED]' OR C MATCHES '${blocklistRegex}' ORDER BY A DESC LIMIT 10 LABEL A '', B '', C ''", 0)`;
          
          // Section Titles (Row 19)
          seedData[18][0] = "🔍 Last 10 Keyword Searches";
          seedData[18][4] = "🌙 Night Owl Hours (11PM - 4AM)";
          
          // Sub-Headers (Row 20)
          seedData[19][0] = "Time"; seedData[19][1] = "Search String";
          seedData[19][4] = "Time"; seedData[19][5] = "Page Title"; seedData[19][6] = "Domain Context";
          
          // Formulas (Row 21)
          seedData[20][0] = `=QUERY('📋 Activity Logs'!A2:D, "SELECT A, D WHERE D IS NOT NULL AND D != '' AND NOT A CONTAINS '[ALERT]' ORDER BY A DESC LIMIT 10 LABEL A '', D ''", 0)`;
          seedData[20][4] = `=ARRAYFORMULA(QUERY(LET(t, '📋 Activity Logs'!A2:A, title, '📋 Activity Logs'!B2:B, url, '📋 Activity Logs'!C2:C, hr, IFERROR(VALUE(REGEXEXTRACT(t, "(\\\\d+):\\\\d+ [AP]M$"))), ampm, IFERROR(REGEXEXTRACT(t, "([AP]M)$")), valid, FILTER(HSTACK(t, title, HYPERLINK(url, REGEXEXTRACT(url, "https?://([^/]+)"))), NOT(REGEXMATCH(url, "(?i)\\\\[ALERT\\\\]")), ((ampm="PM")*(hr>=11)) + ((ampm="AM")*(hr<4)) + ((ampm="AM")*(hr=12))), valid), "SELECT Col1, Col2, Col3 LIMIT 10 LABEL Col1 '', Col2 '', Col3 ''", 0))`;

          fetch(seedUrl, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: seedData })
          })
          .then(() => {
            fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}/values/📋 Activity Logs!A1:D1?valueInputOption=USER_ENTERED`, {
              method: "PUT",
              headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ values: [["Timestamp", "Page Title", "URL Path", "Search Query"]] })
            })
            .then(() => { 
              appendLogsToSpreadsheet(newSheetId, token, initialRows); 
              triggerWeeklyEmailReport();
            });
          });
        });
      }
    })
    .catch(err => console.error("Sheet initialization error:", err));
  });
}

function appendLogsToSpreadsheet(sheetId, token, rows) {
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/📋 Activity Logs!A:D:append?valueInputOption=USER_ENTERED`;
  
  fetch(appendUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows })
  })
  .then(response => {
    if (response.status === 401) {
      refreshAuthToken((newToken) => { appendLogsToSpreadsheet(sheetId, newToken, rows); });
      throw new Error("Re-authenticating session permissions...");
    }
    return response.json();
  })
  .then(() => {
    chrome.storage.local.set({ logBuffer: [] });
    fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, { headers: { "Authorization": `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (!d.sheets || d.sheets.length < 2) return;
        const logsId = d.sheets[1].properties.sheetId;
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [{ autoResizeDimensions: { dimensions: { sheetId: logsId, dimension: "COLUMNS", startIndex: 0, endIndex: 4 } } }] })
        });
      });
  })
  .catch(err => console.warn(err.message));
}

function triggerWeeklyEmailReport() {
  chrome.storage.local.get(["authToken", "spreadsheetId", "partnerEmail"], (data) => {
    if (data.authToken && data.spreadsheetId && data.partnerEmail) {
      const shareUrl = `https://www.googleapis.com/drive/v3/files/${data.spreadsheetId}/permissions?sendNotificationEmail=true`;
      fetch(shareUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${data.authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "user", emailAddress: data.partnerEmail.trim() })
      }).then(res => { if (res.status === 401) refreshAuthToken(); });
    }
  });
}

// ==========================================
// 4. DYNAMIC INTERCEPTION ENGINE (Blocklist vs Whitelist)
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
        // Whitelist Mode: Block everything EXCEPT explicitly listed domains
        const inWhitelist = settings.customWhitelist.some(domain => {
          const cleanDomain = domain.toLowerCase().trim();
          return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
        });
        shouldBlock = !inWhitelist;
      } else {
        // Blocklist Mode: Block only explicit matches
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

    addToBuffer({ url: finalUrl, title: title, searchQuery: searchQuery, timestamp: cleanLocalTime });
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