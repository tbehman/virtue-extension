// Listen for messages from background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SHOW_REAUTH_BANNER") {
    injectReauthBanner();
  } else if (request.type === "HIDE_REAUTH_BANNER") {
    removeReauthBanner();
  }
});

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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 12px 16px;
    text-align: center;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  `;

  banner.innerHTML = `
    <span>🛡️ <strong>Virtue Alert:</strong> Google sync needs to be refreshed to keep accountability active.</span>
    <button id="virtue-reauth-btn" style="
      background-color: #ffffff;
      color: #dc3545;
      border: none;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    ">Reconnect Now ➔</button>
  `;

  document.body.prepend(banner);

  document.getElementById("virtue-reauth-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TRIGGER_INTERACTIVE_AUTH" });
  });
}

function removeReauthBanner() {
  const banner = document.getElementById("virtue-reauth-banner");
  if (banner) banner.remove();
}