// Inject Re-Auth Failure Banner safely without triggering context errors
function injectReauthBanner() {
  if (document.getElementById("virtue-reauth-banner")) return;

  const banner = document.createElement("div");
  banner.id = "virtue-reauth-banner";
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    background-color: #dc3545;
    color: #ffffff;
    text-align: center;
    padding: 10px 15px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    z-index: 2147483647;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
  `;

  banner.innerHTML = `
    <span>🛡️ <strong>Virtue Alert:</strong> Google sync needs to be refreshed to keep accountability active.</span>
    <button id="virtue-reauth-btn" style="
      background-color: #ffffff;
      color: #dc3545;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
      font-size: 13px;
      transition: opacity 0.2s;
    ">Reconnect Now ➔</button>
  `;

  document.body.prepend(banner);

  document.getElementById("virtue-reauth-btn").addEventListener("click", () => {
    try {
      chrome.runtime.sendMessage({ type: "TRIGGER_INTERACTIVE_AUTH" }, (response) => {
        if (chrome.runtime.lastError) {
          // Extension was reloaded/updated; refresh page to re-establish connection
          window.location.reload();
        }
      });
    } catch (e) {
      // Catch "Extension context invalidated" gracefully
      window.location.reload();
    }
  });
}

function removeReauthBanner() {
  const banner = document.getElementById("virtue-reauth-banner");
  if (banner) banner.remove();
}

// Safely listen for background commands
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SHOW_REAUTH_BANNER") {
    injectReauthBanner();
  } else if (request.type === "HIDE_REAUTH_BANNER") {
    removeReauthBanner();
  }
});