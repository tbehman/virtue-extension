document.addEventListener("DOMContentLoaded", () => {
  const modeIcon = document.getElementById("modeIcon");
  const headline = document.getElementById("headline");
  const message = document.getElementById("message");
  const safetyBtn = document.getElementById("safetyBtn");
  const revealOverrideLink = document.getElementById("revealOverrideLink");
  const overridePanel = document.getElementById("overridePanel");
  const pinInput = document.getElementById("pinInput");
  const confirmOverrideBtn = document.getElementById("confirmOverrideBtn");

  // Parse the query parameters to find out which website triggered the redirect
  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get("target") || "https://google.com";

  // Check the active accountability profile
  chrome.storage.local.get({ accountabilityMode: "conscience", masterPin: "" }, (settings) => {
    
    if (settings.accountabilityMode === "guardian") {
      // ---------------------------------------------
      // 🛡️ GUARDIAN MODE USER INTERFACE TUNE
      // ---------------------------------------------
      modeIcon.textContent = "🛡️";
      modeIcon.style.color = "#c62828"; // Warning Red
      headline.textContent = "Focus Enforced";
      message.textContent = "This website is restricted. Your accountability log has recorded this attempt.";
      
      // Keep options hidden for minors; no override paths exist
      revealOverrideLink.classList.add("hidden");
      
    } else {
      // ---------------------------------------------
      // 💡 CONSCIENCE MODE USER INTERFACE TUNE (Adult)
      // ---------------------------------------------
      modeIcon.textContent = "💡";
      modeIcon.style.color = "#2e7d32"; // Conscience Green
      headline.textContent = "A Moment of Pause";
      message.textContent = "This site is on your custom blocklist. Take a breath and choose integrity over impulse. Private victories stay private.";
      
      // Reveal the speed bump backdoor hook for adults
      revealOverrideLink.classList.remove("hidden");
    }

    // Direct route out: Takes them straight to safe ground (Google or search homepage)
    safetyBtn.addEventListener("click", () => {
      window.location.href = "https://google.com";
    });

    // Reveal the hidden PIN panel when requested
    revealOverrideLink.addEventListener("click", () => {
      overridePanel.classList.remove("hidden");
      revealOverrideLink.classList.add("hidden");
      pinInput.focus();
    });

    // Handle authentication loop verification
    confirmOverrideBtn.addEventListener("click", () => {
      const inputPin = pinInput.value.trim();

      if (inputPin === settings.masterPin) {
        // Build the target bypass URL structure
        const targetObj = new URL(targetUrl);
        // Append our validation parameter smoothly regardless of existing query strings
        targetObj.searchParams.set("virtue_bypass", "true");
        
        // Pass the adult back to the browser worker pipeline to log [VISITED]
        window.location.href = targetObj.toString();
      } else {
        alert("Incorrect Master PIN.");
        pinInput.value = "";
        pinInput.focus();
      }
    });

    // Allow submission via the Enter key inside the text field
    pinInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") confirmOverrideBtn.click();
    });
  });
});