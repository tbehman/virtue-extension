document.addEventListener("DOMContentLoaded", () => {
  const safetyBtn = document.getElementById("safetyBtn");
  const revealOverrideLink = document.getElementById("revealOverrideLink");
  const overridePanel = document.getElementById("overridePanel");
  const pinInput = document.getElementById("pinInput");
  const confirmOverrideBtn = document.getElementById("confirmOverrideBtn");
  const permanentAddCheckbox = document.getElementById("permanentAddCheckbox");

  const scriptureText = document.getElementById("scriptureText");
  const scriptureRef = document.getElementById("scriptureRef");

  const userNameEl = document.getElementById("userName");
  const partnerNameEl = document.getElementById("partnerName");

  const targetUrlDisplay = document.getElementById("targetUrlDisplay");
  const reasonDisplay = document.getElementById("reasonDisplay");
  const approvedAccordion = document.getElementById("approvedAccordion");
  const accordionSummaryTitle = document.getElementById("accordionSummaryTitle");
  const approvedSitesList = document.getElementById("approvedSitesList");

  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get("target") || "https://www.google.com";
  const reasonParam = urlParams.get("reason") || "domain";

  // Display Target URL
  if (targetUrlDisplay) {
    targetUrlDisplay.textContent = targetUrl;
  }

  // 1. KJV Scriptures
  const KJV_SCRIPTURES = [
    { text: '"Create in me a clean heart, O God; and renew a right spirit within me."', ref: '— Psalm 51:10' },
    { text: '"There hath no temptation taken you but such as is common to man: but God is faithful, who will not suffer you to be tempted above that ye are able; but will with the temptation also make a way to escape, that ye may be able to bear it."', ref: '— 1 Corinthians 10:13' },
    { text: '"Finally, brethren, whatsoever things are true, whatsoever things are honest, whatsoever things are just, whatsoever things are pure, whatsoever things are lovely, whatsoever things are of good report... think on these things."', ref: '— Philippians 4:8' },
    { text: '"Thy word have I hid in mine heart, that I might not sin against thee."', ref: '— Psalm 119:11' },
    { text: '"And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God."', ref: '— Romans 12:2' },
    { text: '"Submit yourselves therefore to God. Resist the devil, and he will flee from you."', ref: '— James 4:7' },
    { text: '"For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind."', ref: '— 2 Timothy 1:7' },
    { text: '"Wherewithal shall a young man cleanse his way? by taking heed thereto according to thy word."', ref: '— Psalm 119:9' }
  ];

  const randomVerse = KJV_SCRIPTURES[Math.floor(Math.random() * KJV_SCRIPTURES.length)];
  if (scriptureText && scriptureRef) {
    scriptureText.textContent = randomVerse.text;
    scriptureRef.textContent = randomVerse.ref;
  }

  // 2. Personalization & Storage Fetch (Filter Mode, Names, Approved List)
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["userFirstName", "partnerFirstName", "filterMode", "customApprovedList"], (data) => {
      if (userNameEl && data.userFirstName) {
        userNameEl.textContent = data.userFirstName;
      }
      if (partnerNameEl && data.partnerFirstName) {
        partnerNameEl.textContent = data.partnerFirstName;
      }

      const isStrict = data.filterMode === "strict";

      // Format Reason Text cleanly
      if (reasonDisplay) {
        if (isStrict) {
          reasonDisplay.textContent = "Strict Mode active (Not on Approved List)";
        } else if (reasonParam === "keyword") {
          reasonDisplay.textContent = "Detected restricted keyword match";
        } else if (reasonParam === "blocklist") {
          reasonDisplay.textContent = "Matched your Custom Blocklist";
        } else {
          reasonDisplay.textContent = "Matched default protection list";
        }
      }

      // If Strict Mode, show and populate the Approved Sites Accordion
      if (isStrict && approvedAccordion && approvedSitesList) {
        approvedAccordion.classList.remove("hidden");
        const approvedDomains = data.customApprovedList || [];
        
        if (accordionSummaryTitle) {
          accordionSummaryTitle.textContent = `View Approved Sites (${approvedDomains.length} allowed)`;
        }

        if (approvedDomains.length > 0) {
          approvedSitesList.innerHTML = approvedDomains.map(domain => {
            const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
            return `<li><a href="https://${cleanDomain}" target="_blank">🔗 ${cleanDomain}</a></li>`;
          }).join('');
        } else {
          approvedSitesList.innerHTML = `<li style="color: #64748b; font-style: italic;">No sites currently on Approved List</li>`;
        }
      }
    });
  }

  // 3. Leave This Page (Close Tab & Fallback)
  if (safetyBtn) {
    safetyBtn.addEventListener("click", () => {
      window.close();
      
      // Fallback if browser security prevents closing programmatically
      setTimeout(() => {
        window.location.href = "about:blank";
      }, 100);
    });
  }

  // 4. Reveal Override Section
  if (revealOverrideLink) {
    revealOverrideLink.addEventListener("click", (e) => {
      e.preventDefault();
      overridePanel.classList.remove("hidden");
      revealOverrideLink.classList.add("hidden");
      pinInput.focus();
    });
  }

  // 5. Confirm Override
  if (confirmOverrideBtn) {
    confirmOverrideBtn.addEventListener("click", handleOverrideSubmit);
  }

  if (pinInput) {
    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handleOverrideSubmit();
      }
    });
  }

  function handleOverrideSubmit() {
    const enteredPin = pinInput.value.trim();
    const isPermanentAdd = permanentAddCheckbox ? permanentAddCheckbox.checked : false;

    chrome.storage.local.get(["userPin", "logBuffer", "customApprovedList"], (data) => {
      const storedPin = data.userPin;

      if (!storedPin) {
        alert("No PIN has been set yet. Please configure your PIN in the extension options.");
        return;
      }

      if (enteredPin === storedPin) {
        let bypassUrl;
        try {
          bypassUrl = new URL(targetUrl);
        } catch {
          bypassUrl = new URL("https://www.google.com");
        }
        
        bypassUrl.searchParams.set("virtue_bypass", "true");
        const targetDomain = bypassUrl.hostname.toLowerCase().replace('www.', '');

        const buffer = data.logBuffer || [];
        let logTitle = `[ONE-TIME BYPASS] ${targetUrl}`;
        let logTypeTag = "PIN_OVERRIDE_TEMPORARY";

        const updates = { logBuffer: buffer };

        // Handle Permanent Approved List Addition if Checked
        if (isPermanentAdd) {
          const approvedList = data.customApprovedList || [];
          if (!approvedList.includes(targetDomain)) {
            approvedList.push(targetDomain);
            updates.customApprovedList = approvedList;
            updates.settingsLastUpdated = Date.now();
          }
          logTitle = `[APPROVED LIST ADDITION] ${targetUrl}`;
          logTypeTag = "PIN_OVERRIDE_APPROVED";
        }

        buffer.push({
          url: targetUrl,
          title: logTitle,
          searchQuery: "",
          device: getDeviceInfo(),
          timestamp: new Date().toISOString(),
          flagged: true,
          overrideType: logTypeTag
        });

        chrome.storage.local.set(updates, () => {
          window.location.href = bypassUrl.toString();
        });
      } else {
        alert("Incorrect PIN.");
        pinInput.value = "";
        pinInput.focus();
      }
    });
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
});