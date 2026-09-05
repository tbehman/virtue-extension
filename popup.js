document.addEventListener("DOMContentLoaded", () => {
  const modeBadge = document.getElementById("modeBadge");
  const filterModeText = document.getElementById("filterModeText");
  const openDashboardBtn = document.getElementById("openDashboardBtn");
  const openOptionsBtn = document.getElementById("openOptionsBtn");

  // Load current filtering mode state
  chrome.storage.local.get(["filterMode", "driveFileId", "masterKeyHex"], (res) => {
    const mode = res.filterMode || "blocklist";

    if (mode === "whitelist") {
      modeBadge.className = "mode-badge badge-whitelist";
      modeBadge.textContent = "📖 Whitelist";
      filterModeText.textContent = "📖 Whitelist Mode";
    } else {
      modeBadge.className = "mode-badge badge-blocklist";
      modeBadge.textContent = "🛡️ Blocklist";
      filterModeText.textContent = "🛡️ Blocklist Mode";
    }

    // Open Web Dashboard with parameters
    openDashboardBtn.addEventListener("click", () => {
      const fileId = res.driveFileId;
      const keyHex = res.masterKeyHex;

      let dashboardUrl = "https://tbehman.github.io/virtue-extension/";
      if (fileId) {
        dashboardUrl += `?fileId=${encodeURIComponent(fileId)}`;
        if (keyHex) {
          dashboardUrl += `#key=${encodeURIComponent(keyHex)}`;
        }
      }

      chrome.tabs.create({ url: dashboardUrl });
    });
  });

  // Open Extension Settings Options Page
  openOptionsBtn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    }
  });
});