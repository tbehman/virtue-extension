// ==========================================
// 1. CHROME EXTENSION CONFIGURATION
// ==========================================
// Splitting the long URL into two pieces to prevent text-editor line wrapping bugs
const BASE_URL = "https://script.google.com/macros/s/";
const SCRIPT_ID = "AKfycbyMZt0XdisYwfaSl5ChsKWIGXNIIt9hoj8OXNLiDWG3pC7v5GSQWVg7aKtYhTZ1p-tt/exec";
const GOOGLE_SCRIPT_URL = BASE_URL + SCRIPT_ID;

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
// 3. GOOGLE SHEETS NETWORK WEBHOOK
// ==========================================
function sendToGoogleSheet(payload) {
  fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
  .then(() => console.log("Successfully logged to Virtue Sheet!"))
  .catch(error => console.error("Virtue Network Error:", error));
}

// Helper to look up page titles using the tabs permission
function processNavigation(url, tabId) {
  chrome.tabs.get(tabId, (tab) => {
    const title = tab ? tab.title : ""; 
    const searchQuery = extractSearchQuery(url);

    const payload = {
      url: url,
      title: title,
      searchQuery: searchQuery,
      timestamp: new Date().toISOString()
    };

    sendToGoogleSheet(payload);
  });
}

// ==========================================
// 4. MAIN BROWSER EVENT LISTENERS (Task 1.2)
// ==========================================

// Listener A: Standard page navigations
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return; 
  processNavigation(details.url, details.tabId);
});

// Listener B: Modern dynamic SPA navigations (YouTube, Reels, Gemini)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return; 
  processNavigation(details.url, details.tabId);
});