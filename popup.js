import { deriveKeyFromPin } from './cryptoUtils.js';

document.addEventListener("DOMContentLoaded", async () => {
  const setupScreen = document.getElementById("setupScreen");
  const dashboardScreen = document.getElementById("dashboardScreen");
  const settingsScreen = document.getElementById("settingsScreen");

  const authStepContainer = document.getElementById("authStepContainer");
  const authGoogleBtn = document.getElementById("authGoogleBtn");
  const existingVaultNotice = document.getElementById("existingVaultNotice");
  const profileFormFields = document.getElementById("profileFormFields");

  const userNameInput = document.getElementById("userNameInput");
  const partnerNameInput = document.getElementById("partnerNameInput");
  const partnerEmailInput = document.getElementById("partnerEmailInput");
  const masterPinInput = document.getElementById("masterPinInput");
  const completeSetupBtn = document.getElementById("completeSetupBtn");
  const openExtensionSettingsBtn = document.getElementById("openExtensionSettingsBtn");

  const accountDisplay = document.getElementById("accountDisplay");
  const partnerDisplayEmail = document.getElementById("partnerDisplayEmail");
  const viewSheetLink = document.getElementById("viewSheetLink");
  const openSettingsBtn = document.getElementById("openSettingsBtn");

  const pinPromptArea = document.getElementById("pinPromptArea");
  const verifyPinInput = document.getElementById("verifyPinInput");
  const submitPinBtn = document.getElementById("submitPinBtn");
  const cancelPinBtn = document.getElementById("cancelPinBtn");
  const forgotPinLink = document.getElementById("forgotPinLink");

  const backToDashboardBtn = document.getElementById("backToDashboardBtn");
  const editUserNameInput = document.getElementById("editUserNameInput");
  const editPartnerNameInput = document.getElementById("editPartnerNameInput");
  const editPartnerEmailInput = document.getElementById("editPartnerEmailInput");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const profileStatusText = document.getElementById("profileStatusText");

  const modeBlocklistBtn = document.getElementById("modeBlocklistBtn");
  const modeWhitelistBtn = document.getElementById("modeWhitelistBtn");
  const domainInput = document.getElementById("domainInput");
  const addDomainBtn = document.getElementById("addDomainBtn");
  const domainView = document.getElementById("domainView");
  const domainSectionTitle = document.getElementById("domainSectionTitle");
  const domainSectionSubtext = document.getElementById("domainSectionSubtext");

  const settingsUserEmail = document.getElementById("settingsUserEmail");
  const forgotPinModal = document.getElementById("forgotPinModal");
  const sendRecoveryEmailBtn = document.getElementById("sendRecoveryEmailBtn");
  const closeForgotPinBtn = document.getElementById("closeForgotPinBtn");

  let localState = {};

  // ==========================================
  // 1. INITIALIZATION & ROUTING
  // ==========================================
  async function initPopup() {
    chrome.storage.local.get([
      "userEmail", "userName", "partnerName", "partnerEmail", "userPin",
      "driveFileId", "filterMode", "customBlacklist", "customWhitelist"
    ], async (res) => {
      localState = res;

      if (!res.userEmail) {
        showScreen("setup");
        authStepContainer.classList.remove("hidden");
        profileFormFields.classList.add("hidden");
      } else if (!res.userName || !res.partnerEmail || !res.userPin) {
        showScreen("setup");
        authStepContainer.classList.add("hidden");
        profileFormFields.classList.remove("hidden");
      } else {
        showScreen("dashboard");
        renderDashboardView();
      }
    });
  }

  function showScreen(screenName) {
    setupScreen.classList.add("hidden");
    dashboardScreen.classList.add("hidden");
    settingsScreen.classList.add("hidden");

    if (screenName === "setup") setupScreen.classList.remove("hidden");
    if (screenName === "dashboard") dashboardScreen.classList.remove("hidden");
    if (screenName === "settings") settingsScreen.classList.remove("hidden");
  }

  // ==========================================
  // 2. DASHBOARD LINK & DECRYPTION KEY DERIVATION
  // ==========================================
  async function renderDashboardView() {
    accountDisplay.textContent = localState.userEmail || "Connected";
    partnerDisplayEmail.textContent = localState.partnerEmail || "None Assigned";

    const pin = localState.userPin || "1234";
    const email = localState.userEmail || "user@virtue.app";

    try {
      const { keyHex } = await deriveKeyFromPin(pin, email);
      const fileId = localState.driveFileId || "";
      const fullDashboardUrl = `https://tbehman.github.io/virtue-extension/?fileId=${fileId}#key=${keyHex}`;

      viewSheetLink.href = fullDashboardUrl;
    } catch (e) {
      console.error("Error generating dashboard encryption key:", e);
    }
  }

  // Force-attach derived key on click event
  viewSheetLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const pin = localState.userPin || "1234";
    const email = localState.userEmail || "user@virtue.app";
    const fileId = localState.driveFileId || "";

    try {
      const { keyHex } = await deriveKeyFromPin(pin, email);
      const targetUrl = `https://tbehman.github.io/virtue-extension/?fileId=${fileId}#key=${keyHex}`;
      chrome.tabs.create({ url: targetUrl });
    } catch (err) {
      console.error("Dashboard link error:", err);
    }
  });

  // ==========================================
  // 3. AUTHENTICATION & SETUP FLOW
  // ==========================================
  authGoogleBtn.addEventListener("click", () => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        alert("Google Authentication failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
        return;
      }

      fetch("https://www.googleapis.com/oauth2/02/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(profile => {
        const userEmail = profile.email;
        chrome.storage.local.set({ userEmail, authToken: token }, () => {
          localState.userEmail = userEmail;
          authStepContainer.classList.add("hidden");
          profileFormFields.classList.remove("hidden");
        });
      })
      .catch(() => {
        chrome.storage.local.set({ userEmail: "connected.user@gmail.com", authToken: token }, () => {
          localState.userEmail = "connected.user@gmail.com";
          authStepContainer.classList.add("hidden");
          profileFormFields.classList.remove("hidden");
        });
      });
    });
  });

  openExtensionSettingsBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
  });

  completeSetupBtn.addEventListener("click", () => {
    const userName = userNameInput.value.trim();
    const partnerName = partnerNameInput.value.trim();
    const partnerEmail = partnerEmailInput.value.trim();
    const userPin = masterPinInput.value.trim();

    if (!userName || !partnerName || !partnerEmail || userPin.length !== 4) {
      alert("Please fill in all fields and provide a 4-digit PIN.");
      return;
    }

    const updates = {
      userName,
      partnerName,
      partnerEmail,
      userPin,
      settingsLastUpdated: Date.now()
    };

    chrome.storage.local.set(updates, () => {
      Object.assign(localState, updates);
      showScreen("dashboard");
      renderDashboardView();
      chrome.runtime.sendMessage({ type: "TRIGGER_INTERACTIVE_AUTH" });
    });
  });

  // ==========================================
  // 4. PIN SECURITY & SETTINGS ROUTING
  // ==========================================
  openSettingsBtn.addEventListener("click", () => {
    pinPromptArea.classList.remove("hidden");
    verifyPinInput.value = "";
    verifyPinInput.focus();
  });

  cancelPinBtn.addEventListener("click", () => {
    pinPromptArea.classList.add("hidden");
  });

  submitPinBtn.addEventListener("click", unlockSettings);
  verifyPinInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") unlockSettings();
  });

  function unlockSettings() {
    const enteredPin = verifyPinInput.value.trim();
    if (enteredPin === localState.userPin) {
      pinPromptArea.classList.add("hidden");
      loadSettingsScreen();
      showScreen("settings");
    } else {
      alert("Incorrect Security PIN.");
      verifyPinInput.value = "";
    }
  }

  forgotPinLink.addEventListener("click", (e) => {
    e.preventDefault();
    forgotPinModal.classList.remove("hidden");
  });

  closeForgotPinBtn.addEventListener("click", () => {
    forgotPinModal.classList.add("hidden");
  });

  sendRecoveryEmailBtn.addEventListener("click", () => {
    sendRecoveryEmailBtn.disabled = true;
    sendRecoveryEmailBtn.textContent = "Sending...";

    chrome.runtime.sendMessage({ type: "RECOVER_USER_PIN" }, (response) => {
      sendRecoveryEmailBtn.disabled = false;
      sendRecoveryEmailBtn.textContent = "Send Email";
      forgotPinModal.classList.add("hidden");

      if (response && response.success) {
        alert("Recovery email dispatched to " + localState.userEmail);
      } else {
        alert("Failed to send recovery email. Ensure Google account is connected.");
      }
    });
  });

  // ==========================================
  // 5. SETTINGS MANAGEMENT
  // ==========================================
  function loadSettingsScreen() {
    editUserNameInput.value = localState.userName || "";
    editPartnerNameInput.value = localState.partnerName || "";
    editPartnerEmailInput.value = localState.partnerEmail || "";
    settingsUserEmail.textContent = localState.userEmail || "Not Connected";

    renderDomainList();
  }

  backToDashboardBtn.addEventListener("click", () => {
    showScreen("dashboard");
    renderDashboardView();
  });

  saveProfileBtn.addEventListener("click", () => {
    const newUserName = editUserNameInput.value.trim();
    const newPartnerName = editPartnerNameInput.value.trim();
    const newPartnerEmail = editPartnerEmailInput.value.trim();

    if (!newUserName || !newPartnerName || !newPartnerEmail) {
      alert("Profile fields cannot be empty.");
      return;
    }

    const updates = {
      userName: newUserName,
      partnerName: newPartnerName,
      partnerEmail: newPartnerEmail,
      settingsLastUpdated: Date.now()
    };

    chrome.storage.local.set(updates, () => {
      Object.assign(localState, updates);
      profileStatusText.style.display = "block";
      profileStatusText.textContent = "✓ Profile saved!";
      setTimeout(() => { profileStatusText.style.display = "none"; }, 2500);
    });
  });

  // Mode & Domain Management
  modeBlocklistBtn.addEventListener("click", () => setFilterMode("blocklist"));
  modeWhitelistBtn.addEventListener("click", () => setFilterMode("whitelist"));

  function setFilterMode(mode) {
    localState.filterMode = mode;
    chrome.storage.local.set({ filterMode: mode, settingsLastUpdated: Date.now() });

    if (mode === "blocklist") {
      modeBlocklistBtn.classList.add("active");
      modeWhitelistBtn.classList.remove("active");
      domainSectionTitle.textContent = "🚫 CUSTOM BLOCKLIST";
      domainSectionSubtext.textContent = "Explicitly listed domains will be intercepted.";
    } else {
      modeWhitelistBtn.classList.add("active");
      modeBlocklistBtn.classList.remove("active");
      domainSectionTitle.textContent = "✅ CUSTOM WHITELIST";
      domainSectionSubtext.textContent = "ONLY explicitly listed domains will be allowed.";
    }

    renderDomainList();
  }

  addDomainBtn.addEventListener("click", () => {
    const domain = domainInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (!domain) return;

    const listKey = localState.filterMode === "whitelist" ? "customWhitelist" : "customBlacklist";
    const currentList = localState[listKey] || [];

    if (!currentList.includes(domain)) {
      currentList.push(domain);
      localState[listKey] = currentList;

      chrome.storage.local.set({ [listKey]: currentList, settingsLastUpdated: Date.now() }, () => {
        domainInput.value = "";
        renderDomainList();
      });
    }
  });

  function renderDomainList() {
    const mode = localState.filterMode || "blocklist";
    const listKey = mode === "whitelist" ? "customWhitelist" : "customBlacklist";
    const domains = localState[listKey] || [];

    domainView.innerHTML = domains.map((domain, index) => `
      <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px;">
        <span>${domain}</span>
        <button data-index="${index}" class="remove-domain-btn" style="background: none; border: none; color: var(--danger); cursor: pointer; font-weight: bold;">✕</button>
      </li>
    `).join('');

    document.querySelectorAll(".remove-domain-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-index"), 10);
        domains.splice(idx, 1);
        localState[listKey] = domains;

        chrome.storage.local.set({ [listKey]: domains, settingsLastUpdated: Date.now() }, () => {
          renderDomainList();
        });
      });
    });
  }

  // Run initialization
  initPopup();
});