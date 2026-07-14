// Helper to extract search queries from Google
function extractSearchQuery(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes("google.com") && url.pathname.includes("search")) {
      return url.searchParams.get("q");
    }
  } catch (e) {}
  return null;
}

// Listen for page navigation
chrome.webNavigation.onCompleted.addListener((details) => {
  // Only look at top-level pages, not embedded ads or frames
  if (details.frameId === 0) {
    const timestamp = new Date().toLocaleString();
    const url = details.url;
    const searchQuery = extractSearchQuery(url);

    // Retrieve the user's Webhook URL
    chrome.storage.local.get('webhookUrl', (data) => {
      if (!data.webhookUrl) {
        console.log("Virtue: No Google Sheet Webhook URL saved yet.");
        return;
      }

      const payload = {
        timestamp: timestamp,
        url: url,
        searchQuery: searchQuery
      };

      // Push to Google Sheets asynchronously (Real-time for this fast POC)
      fetch(data.webhookUrl, {
        method: "POST",
        mode: "no-cors", // Required to send requests to Google Apps Script cleanly
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      .then(() => console.log("Virtue: Logged " + url))
      .catch(err => console.error("Virtue: Failed to log", err));
    });
  }
});