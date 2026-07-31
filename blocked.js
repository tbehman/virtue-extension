document.addEventListener("DOMContentLoaded", () => {
  const safetyBtn = document.getElementById("safetyBtn");
  const revealOverrideLink = document.getElementById("revealOverrideLink");
  const overridePanel = document.getElementById("overridePanel");
  const pinInput = document.getElementById("pinInput");
  const confirmOverrideBtn = document.getElementById("confirmOverrideBtn");

  // Parse target URL passed in the query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get("target") || "https://www.google.com";

  // 1. Primary Escape Route: Direct user back to safety
  safetyBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "https://www.google.com";
    }
  });

  // 2. Reveal PIN Friction Wall
  revealOverrideLink.addEventListener("click", (e) => {
    e.preventDefault();
    overridePanel.classList.remove("hidden");
    revealOverrideLink.classList.add("hidden");
    pinInput.focus();
  });

  // 3. Confirm Master PIN Override
  confirmOverrideBtn.addEventListener("click", () => {
    const enteredPin = pinInput.value.trim();

    chrome.storage.local.get(["masterPin", "logBuffer"], (data) => {
      if (enteredPin && enteredPin === data.masterPin) {
        // Build bypass URL with query parameter so background.js logs [VISITED]
        const bypassUrl = new URL(targetUrl);
        bypassUrl.searchParams.set("virtue_bypass", "true");

        // Log the override action explicitly
        const buffer = data.logBuffer || [];
        buffer.push({
          url: `[OVERRIDE BYPASS] ${targetUrl}`,
          title: `[OVERRIDE BYPASS] ${targetUrl}`,
          searchQuery: "",
          device: getDeviceInfo(),
          timestamp: new Date().toISOString(),
          flagged: true
        });

        chrome.storage.local.set({ logBuffer: buffer }, () => {
          // Redirect user to destination page with bypass key
          window.location.href = bypassUrl.toString();
        });
      } else {
        alert("Incorrect 4-Digit Master PIN.");
        pinInput.value = "";
        pinInput.focus();
      }
    });
  });

  function getDeviceInfo() {
    const ua = navigator.userAgent;
    let os = "Desktop";
    if (ua.includes("Win")) os = "Windows PC";
    else if (ua.includes("Mac")) os = "Macbook";
    else if (ua.includes("Android")) os = "Android Phone";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS Device";
    return `${os} (Chrome)`;
  }
});