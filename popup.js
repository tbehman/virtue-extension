document.addEventListener("DOMContentLoaded", () => {
  // Screens
  const setupScreen = document.getElementById("setupScreen");
  const dashboardScreen = document.getElementById("dashboardScreen");

  // Onboarding Inputs
  const partnerEmailInput = document.getElementById("partnerEmailInput");
  const masterPinInput = document.getElementById("masterPinInput");
  const authGoogleBtn = document.getElementById("authGoogleBtn");
  const status = document.getElementById("status");

  // Dashboard Header & Status Elements
  const syncBadge = document.getElementById("syncBadge");
  const partnerDisplayEmail = document.getElementById("partnerDisplayEmail");
  const sheetStatusContainer = document.getElementById("sheetStatusContainer");
  const sheetStatusText = document.getElementById("sheetStatusText");
  const viewSheetLink = document.getElementById("viewSheetLink");

  // Dynamic Filtering UI Elements
  const modeToggleContainer = document.getElementById("modeToggleContainer");
  const modeBlocklistBtn = document.getElementById("modeBlocklistBtn");
  const modeWhitelistBtn = document.getElementById("modeWhitelistBtn");
  const domainSectionTitle = document.getElementById("domainSectionTitle");
  const domainSectionSubtext = document.getElementById("domainSectionSubtext");
  const domainContainer = document.getElementById("domainContainer");
  const editDomainRow = document.getElementById("editDomainRow");
  const domainInput = document.getElementById("domainInput");
  const addDomainBtn = document.getElementById("addDomainBtn");
  const domainView = document.getElementById("domainView");

  // Management & Unlock Controls
  const managementRow = document.getElementById("managementRow");
  const recreateSheetBtn = document.getElementById("recreateSheetBtn");
  const lockActionBtn = document.getElementById("lockActionBtn");
  const pinPromptArea = document.getElementById("pinPromptArea");
  const verifyPinInput = document.getElementById("verifyPinInput");
  const submitPinBtn = document.getElementById("submitPinBtn");
  const cancelPinBtn = document.getElementById("cancelPinBtn");
  const forgotPinLink = document.getElementById("forgotPinLink");
  const forgotPinModal = document.getElementById("forgotPinModal");
  const closeForgotPinBtn = document.getElementById("closeForgotPinBtn");

  let isUnlocked = false;
  let cachedPin = "";
  let activeFilterMode = "blocklist"; // 'blocklist' or 'whitelist'

  // GitHub Pages Web Dashboard Base URL
  const GITHUB_DASHBOARD_BASE_URL = "https://tbehman.github.io/virtue-extension/";

  // ==========================================
  // 1. STATE INITIALIZATION ENGINE
  // ==========================================
  function init() {
    chrome.storage.local.get([
      "authToken",
      "partnerEmail",
      "masterPin",
      "filterMode",
      "driveFileId"
    ], (data) => {
      cachedPin = data.masterPin;
      activeFilterMode = data.filterMode || "blocklist";

      if (!data.authToken || !cachedPin) {
        setupScreen.classList.remove("hidden");
        dashboardScreen.classList.add("hidden");
      } else {
        setupScreen.classList.add("hidden");
        dashboardScreen.classList.remove("hidden");
        
        partnerDisplayEmail.textContent = (data.partnerEmail && data.partnerEmail.trim() !== "") 
          ? data.partnerEmail 
          : "No Partner Email Set";
          
        // Render Connection Status & Web Dashboard Link
        if (data.driveFileId) {
          sheetStatusContainer.style.borderLeft = "4px solid #1a73e8";
          sheetStatusText.textContent = "🟢 Drive Telemetry Active & Web Dashboard Linked";
          sheetStatusText.style.color = "#1a73e8";
          
          const dashboardUrl = `${GITHUB_DASHBOARD_BASE_URL}?fileId=${data.driveFileId}`;
          viewSheetLink.href = dashboardUrl;
          viewSheetLink.textContent = "📊 Open Live Web Dashboard ↗";
          viewSheetLink.classList.remove("hidden");
        } else {
          sheetStatusContainer.style.borderLeft = "4px solid #b06000";
          sheetStatusText.textContent = "🟡 Syncing Drive logs & generating dashboard link...";
          sheetStatusText.style.color = "#b06000";
          viewSheetLink.classList.add("hidden");
        }

        updateFilterModeUI();
        applyUIVisibilityState();
        loadDomainList();
      }
    });
  }

  // ==========================================
  // 2. INITIAL ONBOARDING & AUTHENTICATION
  // ==========================================
  authGoogleBtn.addEventListener("click", () => {
    const email = partnerEmailInput.value.trim();
    const pin = masterPinInput.value.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      status.style.color = "#d93025";
      status.textContent = "Please enter a valid partner email address.";
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      status.style.color = "#d93025";
      status.textContent = "Master PIN must be exactly 4 digits.";
      return;
    }

    status.style.color = "#4285F4";
    status.textContent = "Authenticating security credentials...";
    authGoogleBtn.disabled = true;

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        status.style.color = "#d93025";
        status.textContent = "Connection failed: " + (chrome.runtime.lastError?.message || "No service response");
        authGoogleBtn.disabled = false;
        return;
      }

      chrome.storage.local.set({ 
        authToken: token,
        partnerEmail: email,
        masterPin: pin,
        filterMode: "blocklist"
      }, () => {
        authGoogleBtn.disabled = false;
        init();
      });
    });
  });

  // ==========================================
  // 3. SEGMENTED FILTER MODE HANDLERS
  // ==========================================
  function updateFilterModeUI() {
    if (activeFilterMode === "whitelist") {
      modeWhitelistBtn.classList.add("active");
      modeBlocklistBtn.classList.remove("active");
      domainSectionTitle.textContent = "🏰 Whitelist Only (Library Mode)";
      domainSectionSubtext.textContent = "All websites blocked EXCEPT explicitly added domains.";
      domainInput.placeholder = "e.g., wikipedia.org";
    } else {
      modeBlocklistBtn.classList.add("active");
      modeWhitelistBtn.classList.remove("active");
      domainSectionTitle.textContent = "🚫 Custom Blocklist";
      domainSectionSubtext.textContent = "Explicitly listed domains will be intercepted.";
      domainInput.placeholder = "e.g., website.com";
    }
  }

  modeBlocklistBtn.addEventListener("click", () => {
    if (!isUnlocked) return;
    activeFilterMode = "blocklist";
    chrome.storage.local.set({ filterMode: "blocklist" }, () => {
      updateFilterModeUI();
      loadDomainList();
    });
  });

  modeWhitelistBtn.addEventListener("click", () => {
    if (!isUnlocked) return;
    activeFilterMode = "whitelist";
    chrome.storage.local.set({ filterMode: "whitelist" }, () => {
      updateFilterModeUI();
      loadDomainList();
    });
  });

  // ==========================================
  // 4. UNLOCK & PIN SECURITY HANDLERS
  // ==========================================
  function applyUIVisibilityState() {
    if (isUnlocked) {
      lockActionBtn.classList.add("hidden");
      pinPromptArea.classList.add("hidden");
      modeToggleContainer.classList.remove("hidden");
      editDomainRow.classList.remove("hidden");
      managementRow.classList.remove("hidden");
      domainContainer.classList.remove("disabled-view");
    } else {
      lockActionBtn.classList.remove("hidden");
      lockActionBtn.textContent = "🔧 Unlock Settings";
      pinPromptArea.classList.add("hidden");
      modeToggleContainer.classList.add("hidden");
      editDomainRow.classList.add("hidden");
      managementRow.classList.add("hidden");
      domainContainer.classList.add("disabled-view");
    }
  }

  lockActionBtn.addEventListener("click", () => {
    lockActionBtn.classList.add("hidden");
    pinPromptArea.classList.remove("hidden");
    verifyPinInput.value = "";
    verifyPinInput.focus();
  });

  cancelPinBtn.addEventListener("click", () => {
    pinPromptArea.classList.add("hidden");
    lockActionBtn.classList.remove("hidden");
  });

  submitPinBtn.addEventListener("click", () => {
    const inputPin = verifyPinInput.value.trim();
    if (inputPin === cachedPin) {
      isUnlocked = true;
      verifyPinInput.value = "";
      applyUIVisibilityState();
      loadDomainList();
    } else {
      alert("Incorrect 4-Digit Master PIN.");
    }
  });

  // Forgot PIN Modal Trigger
  forgotPinLink.addEventListener("click", (e) => {
    e.preventDefault();
    forgotPinModal.classList.remove("hidden");
  });

  closeForgotPinBtn.addEventListener("click", () => {
    forgotPinModal.classList.add("hidden");
  });

  // ==========================================
  // 5. DOMAIN LIST MANAGEMENT (Blocklist & Whitelist)
  // ==========================================
  function loadDomainList() {
    const storageKey = activeFilterMode === "whitelist" ? "customWhitelist" : "customBlacklist";
    
    chrome.storage.local.get({ [storageKey]: [] }, (result) => {
      const currentList = result[storageKey] || [];
      domainView.innerHTML = "";
      
      if (currentList.length === 0) {
        const emptyLi = document.createElement("li");
        emptyLi.style.color = "#80868b";
        emptyLi.style.fontStyle = "italic";
        emptyLi.textContent = activeFilterMode === "whitelist" ? "No whitelisted domains added." : "No custom blocklist domains added.";
        domainView.appendChild(emptyLi);
        return;
      }

      currentList.forEach((domain) => {
        const li = document.createElement("li");
        li.textContent = domain;
        if (isUnlocked) {
          const delBtn = document.createElement("button");
          delBtn.textContent = "×";
          delBtn.className = "delete-btn";
          delBtn.addEventListener("click", () => removeDomain(domain, storageKey));
          li.appendChild(delBtn);
        }
        domainView.appendChild(li);
      });
    });
  }

  function addDomain() {
    const rawInput = domainInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!rawInput) return;

    const storageKey = activeFilterMode === "whitelist" ? "customWhitelist" : "customBlacklist";

    chrome.storage.local.get({ [storageKey]: [] }, (result) => {
      const currentList = result[storageKey] || [];
      if (!currentList.includes(rawInput)) {
        currentList.push(rawInput);
        chrome.storage.local.set({ [storageKey]: currentList }, () => {
          domainInput.value = "";
          loadDomainList();
        });
      }
    });
  }

  function removeDomain(domainToRemove, storageKey) {
    chrome.storage.local.get({ [storageKey]: [] }, (result) => {
      const updatedList = (result[storageKey] || []).filter(d => d !== domainToRemove);
      chrome.storage.local.set({ [storageKey]: updatedList }, () => {
        loadDomainList();
      });
    });
  }

  addDomainBtn.addEventListener("click", addDomain);

  // ==========================================
  // 6. CONNECTION RE-AUTHENTICATION HANDLER
  // ==========================================
  if (recreateSheetBtn) {
    recreateSheetBtn.textContent = "🔄 Re-authenticate Drive Connection";
    recreateSheetBtn.addEventListener("click", () => {
      if (confirm("Re-authenticate Google Drive connection status?")) {
        recreateSheetBtn.disabled = true;
        recreateSheetBtn.textContent = "⏳ Verifying Connection...";
        sheetStatusText.textContent = "⏳ Re-checking Google Drive asset state...";
        sheetStatusText.style.color = "#b06000";

        chrome.storage.local.get(["authToken"], (res) => {
          const oldToken = res.authToken;
          
          if (oldToken) {
            chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
              triggerRelinkHandshake();
            });
          } else {
            triggerRelinkHandshake();
          }
        });
      }
    });
  }

  function triggerRelinkHandshake() {
    chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
      if (chrome.runtime.lastError || !newToken) {
        alert("Authentication error: Please check your Google Account status.");
        if (recreateSheetBtn) {
          recreateSheetBtn.disabled = false;
          recreateSheetBtn.textContent = "🔄 Re-authenticate Drive Connection";
        }
        init();
        return;
      }

      chrome.storage.local.set({ authToken: newToken }, () => {
        if (recreateSheetBtn) {
          recreateSheetBtn.disabled = false;
          recreateSheetBtn.textContent = "🔄 Re-authenticate Drive Connection";
        }
        alert("Connection re-authenticated successfully!");
        location.reload();
      });
    });
  }

  init();
});