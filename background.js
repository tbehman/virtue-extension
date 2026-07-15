const BASE_URL = "https://script.google.com/macros/s/";
const SCRIPT_ID = "AKfycbyMZt0XdisYwfaSl5ChsKWIGXNIIt9hoj8OXNLiDWG3pC7v5GSQWVg7aKtYhTZ1p-tt/exec";
const GOOGLE_SCRIPT_URL = BASE_URL + SCRIPT_ID;

// Helper function to get clean formatted time
function getCleanTimestamp() {
  const options = { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit', 
    second: '2-digit', 
    hour12: true 
  };
  return new Date().toLocaleString('en-US', options);
}

// ==========================================
// 1. INITIALIZE BACKGROUND ALARMS & SETTINGS
// ==========================================
chrome.runtime.onInstalled.addListener(() => {
  // Sets a timer to flush our local storage logs to Google Sheets every 1 minute
  chrome.alarms.create("flushBuffer", { periodInMinutes: 1 });

  // Initialize core settings default state so you don't instantly lock yourself out of the web
  chrome.storage.local.get(["filterMode", "customWhitelist"], (result) => {
    if (!result.filterMode) {
      chrome.storage.local.set({ 
        filterMode: "whitelist", // Options: "off", "whitelist", "blacklist"
        customWhitelist: ["google.com", "bing.com", "duckduckgo.com", "pcci.edu"] 
      });
    }
  });
});

// ==========================================
// 2. MULTI-SEARCH ENGINE PARSER (Task 1.1)
// ==========================================
function extractSearchQuery(urlStr) {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname;

    const isGoogle = domain.includes("google.com") && url.pathname.includes("/search");
    const isBing = domain.includes("bing.com") && url.pathname.includes("/search");
    const isDuckDuckGo = domain.includes("duckduckgo.com") && url.pathname === "/";

    if (isGoogle || isBing || isDuckDuckGo) {
      const queryParam = url.searchParams.get("q");
      if (queryParam) {
        return decodeURIComponent(queryParam.replace(/\+/g, " "));
      }
    }
  } catch (e) {
    console.error("Error parsing URL:", e);
  }
  return null;
}

// ==========================================
// 3. STORAGE QUEUE & NETWORK FLUSH ENGINE
// ==========================================
function addToBuffer(data) {
  chrome.storage.local.get({ logBuffer: [] }, (result) => {
    const buffer = result.logBuffer;
    buffer.push(data);
    chrome.storage.local.set({ logBuffer: buffer });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flushBuffer") {
    flushBuffer();
  }
});

function flushBuffer() {
  chrome.storage.local.get({ logBuffer: [] }, (result) => {
    const buffer = result.logBuffer;
    if (buffer.length === 0) return;

    // Filter out rapid accidental duplicate events
    let uniqueLogs = Array.from(new Set(buffer.map(a => a.url)))
      .map(url => buffer.find(a => a.url === url));

    // Smart Permission Gatekeeper: Check incognito access status before sending
    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      if (!isAllowed) {
        uniqueLogs.unshift({
          url: "[ALERT] Incognito Tracking is DISABLED in settings!",
          title: "[ALERT] Incognito Tracking is DISABLED in settings!",
          searchQuery: null,
          timestamp: getCleanTimestamp()
        });
      }

      fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uniqueLogs)
      })
      .then(() => {
        console.log("Virtue batch sent successfully!");
        chrome.storage.local.set({ logBuffer: [] }); // Clear buffer upon success
      })
      .catch(err => console.error("Virtue batch network error:", err));
    });
  });
}

// ==========================================
// 4. MAIN EVENT LISTENERS (Navigation & Whitelist Guard)
// ==========================================

// Whitelist Interceptor Engine: Catches requests BEFORE they load
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // Ignore background sub-frames/ads
  
  const urlStr = details.url;
  // Protocol Gatekeeper: Let internal browser pages (chrome://) pass safely
  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
    return;
  }

  chrome.storage.local.get({ filterMode: "off", customWhitelist: [] }, (settings) => {
    if (settings.filterMode !== "whitelist") return;

    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase();
      
      // Check if current site matches or ends with any domain in our whitelist array
      const isWhitelisted = settings.customWhitelist.some(domain => {
        const cleanDomain = domain.toLowerCase().trim();
        return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
      });

      if (!isWhitelisted) {
        // Generate the secure internal path to our local block page
        const blockPageUrl = chrome.runtime.getURL("blocked.html");
        
        // 1. Instantly drop the hammer and redirect to your custom block file
        chrome.tabs.update(details.tabId, { url: blockPageUrl });
        
        // 2. Write a clear, tamper-proof entry to the log sheet buffer
        addToBuffer({
          url: `[BLOCKED] ${urlStr}`,
          title: "[SECURITY ALERT] Attempted access outside Whitelist boundaries",
          searchQuery: null,
          timestamp: getCleanTimestamp()
        });
      }
    } catch (e) {
      console.error("Whitelist parser engine error:", e);
    }
  });
});

function processNavigation(url, tabId) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    let title = tab ? tab.title : "";
    const searchQuery = extractSearchQuery(url);
    const cleanLocalTime = getCleanTimestamp();

    if (tab && tab.incognito) {
      title = `[INCOGNITO] ${title}`;
    }

    const payload = {
      url: url,
      title: title,
      searchQuery: searchQuery,
      timestamp: cleanLocalTime
    };
    
    addToBuffer(payload);
  });
}

// Listener A: Standard page clicks
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  processNavigation(details.url, details.tabId);
});

// Listener B: Modern Single Page Apps (YouTube, Gemini history clicks)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  processNavigation(details.url, details.tabId);
});