import { deriveKeyFromPin } from './cryptoUtils.js';

document.addEventListener("DOMContentLoaded", () => {
  initPopup();
});

function initPopup() {
  loadProfileAndRender();
  setupEventListeners();
  renderScheduleStatus();
  loadDomainRules();
}

function renderScheduleStatus() {
  chrome.storage.local.get(["lastWeeklyReportSentAt", "nextWeeklyReportDueAt"], (data) => {
    const lastSentEl = document.getElementById("lastSentDisplay");
    const nextDueEl = document.getElementById("nextDueDisplay");

    if (lastSentEl) {
      if (data.lastWeeklyReportSentAt) {
        lastSentEl.textContent = new Date(data.lastWeeklyReportSentAt).toLocaleString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      } else {
        lastSentEl.textContent = "Never";
      }
    }

    if (nextDueEl) {
      if (data.nextWeeklyReportDueAt) {
        nextDueEl.textContent = new Date(data.nextWeeklyReportDueAt).toLocaleString([], {
          weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      } else {
        nextDueEl.textContent = "Mon, 9:00 AM";
      }
    }
  });
}

function loadProfileAndRender() {
  chrome.storage.local.get([
    "userEmail", "userName", "partnerName", "partnerEmail", "userPin", "driveFileId"
  ], async (data) => {
    const setupScreen = document.getElementById("setupScreen");
    const dashboardScreen = document.getElementById("dashboardScreen");
    const authStepContainer = document.getElementById("authStepContainer");
    const profileFormFields = document.getElementById("profileFormFields");

    if (data.userEmail && data.partnerEmail && data.userPin) {
      setupScreen.classList.add("hidden");
      dashboardScreen.classList.remove("hidden");

      const accountDisplay = document.getElementById("accountDisplay");
      const partnerDisplayEmail = document.getElementById("partnerDisplayEmail");

      if (accountDisplay) accountDisplay.textContent = data.userEmail || "Connected";
      if (partnerDisplayEmail) partnerDisplayEmail.textContent = data.partnerEmail || "None";

      const editUserNameInput = document.getElementById("editUserNameInput");
      const editPartnerNameInput = document.getElementById("editPartnerNameInput");
      const editPartnerEmailInput = document.getElementById("editPartnerEmailInput");

      if (editUserNameInput) editUserNameInput.value = data.userName || "";
      if (editPartnerNameInput) editPartnerNameInput.value = data.partnerName || "";
      if (editPartnerEmailInput) editPartnerEmailInput.value = data.partnerEmail || "";

      if (data.driveFileId) {
        const viewSheetLink = document.getElementById("viewSheetLink");
        if (viewSheetLink) {
          try {
            const { keyHex } = await deriveKeyFromPin(data.userPin, data.userEmail);
            viewSheetLink.href = `https://tbehman.github.io/virtue-extension/?fileId=${data.driveFileId}#key=${keyHex}`;
          } catch (e) {
            viewSheetLink.href = `https://tbehman.github.io/virtue-extension/?fileId=${data.driveFileId}`;
          }
        }
      }
    } else {
      dashboardScreen.classList.add("hidden");
      setupScreen.classList.remove("hidden");

      if (data.userEmail) {
        if (authStepContainer) authStepContainer.classList.add("hidden");
        if (profileFormFields) profileFormFields.classList.remove("hidden");
      } else {
        if (authStepContainer) authStepContainer.classList.remove("hidden");
        if (profileFormFields) profileFormFields.classList.add("hidden");
      }
    }
  });
}

function setupEventListeners() {
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const backToDashboardBtn = document.getElementById("backToDashboardBtn");
  const settingsScreen = document.getElementById("settingsScreen");
  const dashboardScreen = document.getElementById("dashboardScreen");
  const pinPromptArea = document.getElementById("pinPromptArea");
  const submitPinBtn = document.getElementById("submitPinBtn");
  const cancelPinBtn = document.getElementById("cancelPinBtn");
  const verifyPinInput = document.getElementById("verifyPinInput");

  // Open Settings Trigger -> Show PIN Guard First
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      chrome.storage.local.get(["userPin"], (data) => {
        if (data.userPin) {
          if (pinPromptArea) pinPromptArea.classList.remove("hidden");
          if (verifyPinInput) {
            verifyPinInput.value = "";
            verifyPinInput.focus();
          }
        } else {
          dashboardScreen.classList.add("hidden");
          settingsScreen.classList.remove("hidden");
          renderScheduleStatus();
        }
      });
    });
  }

  // Submit PIN to Unlock Settings
  if (submitPinBtn) {
    submitPinBtn.addEventListener("click", () => {
      const enteredPin = verifyPinInput.value.trim();
      chrome.storage.local.get(["userPin"], (data) => {
        if (enteredPin === data.userPin) {
          if (pinPromptArea) pinPromptArea.classList.add("hidden");
          dashboardScreen.classList.add("hidden");
          settingsScreen.classList.remove("hidden");
          renderScheduleStatus();
        } else {
          alert("Incorrect Master PIN. Please try again.");
          if (verifyPinInput) verifyPinInput.value = "";
        }
      });
    });
  }

  // Cancel PIN Prompt
  if (cancelPinBtn) {
    cancelPinBtn.addEventListener("click", () => {
      if (pinPromptArea) pinPromptArea.classList.add("hidden");
      if (verifyPinInput) verifyPinInput.value = "";
    });
  }

  // Return to Dashboard & Re-lock Settings
  if (backToDashboardBtn) {
    backToDashboardBtn.addEventListener("click", () => {
      settingsScreen.classList.add("hidden");
      dashboardScreen.classList.remove("hidden");
      if (pinPromptArea) pinPromptArea.classList.add("hidden");
    });
  }

  // Open Chrome Extension Settings for Incognito
  const openExtensionSettingsBtn = document.getElementById("openExtensionSettingsBtn");
  if (openExtensionSettingsBtn) {
    openExtensionSettingsBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });
  }

  // Manual "Send Test Report Now"
  const btnSendTest = document.getElementById("btnSendTestReport");
  const feedbackEl = document.getElementById("testReportFeedback");

  if (btnSendTest) {
    btnSendTest.addEventListener("click", () => {
      btnSendTest.disabled = true;
      btnSendTest.textContent = "Sending Snapshot...";
      if (feedbackEl) feedbackEl.style.display = "none";

      chrome.runtime.sendMessage({ type: "SEND_TEST_REPORT" }, (response) => {
        btnSendTest.disabled = false;
        btnSendTest.textContent = "Send Test Report Now";

        if (response && response.success) {
          if (feedbackEl) {
            feedbackEl.style.color = "#198754";
            feedbackEl.style.fontWeight = "bold";
            feedbackEl.textContent = "✅ Test report sent to partner!";
            feedbackEl.style.display = "block";
          }
          renderScheduleStatus();
        } else {
          if (feedbackEl) {
            feedbackEl.style.color = "#dc3545";
            feedbackEl.style.fontWeight = "bold";
            feedbackEl.textContent = "❌ Failed to send. Check partner email.";
            feedbackEl.style.display = "block";
          }
        }
      });
    });
  }

  // Profile Save
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const profileStatusText = document.getElementById("profileStatusText");

  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", () => {
      const newUserName = document.getElementById("editUserNameInput").value.trim();
      const newPartnerName = document.getElementById("editPartnerNameInput").value.trim();
      const newPartnerEmail = document.getElementById("editPartnerEmailInput").value.trim().toLowerCase();

      if (!newPartnerEmail || !newPartnerEmail.includes("@")) {
        profileStatusText.style.color = "#dc3545";
        profileStatusText.textContent = "Please enter a valid partner email address.";
        profileStatusText.style.display = "block";
        return;
      }

      chrome.storage.local.get(["partnerEmail"], (data) => {
        const oldPartnerEmail = data.partnerEmail || "";

        chrome.runtime.sendMessage({
          type: "UPDATE_PROFILE",
          profileData: {
            userName: newUserName,
            partnerName: newPartnerName,
            partnerEmail: newPartnerEmail
          },
          oldPartnerEmail: oldPartnerEmail
        }, (res) => {
          if (res && res.success) {
            profileStatusText.style.color = "#198754";
            profileStatusText.textContent = "Profile saved & syncing permissions...";
            profileStatusText.style.display = "block";
            loadProfileAndRender();
          }
        });
      });
    });
  }

  // Forgot PIN Modal Handlers
  const forgotPinLink = document.getElementById("forgotPinLink");
  const forgotPinModal = document.getElementById("forgotPinModal");
  const closeForgotPinBtn = document.getElementById("closeForgotPinBtn");
  const sendRecoveryEmailBtn = document.getElementById("sendRecoveryEmailBtn");

  if (forgotPinLink) {
    forgotPinLink.addEventListener("click", (e) => {
      e.preventDefault();
      forgotPinModal.classList.remove("hidden");
    });
  }

  if (closeForgotPinBtn) {
    closeForgotPinBtn.addEventListener("click", () => {
      forgotPinModal.classList.add("hidden");
    });
  }

  if (sendRecoveryEmailBtn) {
    sendRecoveryEmailBtn.addEventListener("click", () => {
      sendRecoveryEmailBtn.disabled = true;
      sendRecoveryEmailBtn.textContent = "Sending...";

      chrome.runtime.sendMessage({ type: "RECOVER_USER_PIN" }, (response) => {
        sendRecoveryEmailBtn.disabled = false;
        sendRecoveryEmailBtn.textContent = "Send Email";
        forgotPinModal.classList.add("hidden");

        if (response && response.success) {
          alert("PIN recovery email dispatched to your Google account.");
        } else {
          alert("Failed to send PIN recovery email. Please check internet connection.");
        }
      });
    });
  }
}

function loadDomainRules() {
  const modeBlocklistBtn = document.getElementById("modeBlocklistBtn");
  const modeWhitelistBtn = document.getElementById("modeWhitelistBtn");
  const addDomainBtn = document.getElementById("addDomainBtn");
  const domainInput = document.getElementById("domainInput");

  if (!modeBlocklistBtn || !modeWhitelistBtn) return;

  chrome.storage.local.get(["filterMode", "customBlacklist", "customWhitelist"], (data) => {
    const filterMode = data.filterMode || "blocklist";
    updateModeUI(filterMode);
    renderDomainList(filterMode === "blocklist" ? (data.customBlacklist || []) : (data.customWhitelist || []));
  });

  modeBlocklistBtn.addEventListener("click", () => {
    chrome.storage.local.set({ filterMode: "blocklist" }, () => {
      updateModeUI("blocklist");
      chrome.storage.local.get(["customBlacklist"], (res) => renderDomainList(res.customBlacklist || []));
    });
  });

  modeWhitelistBtn.addEventListener("click", () => {
    chrome.storage.local.set({ filterMode: "whitelist" }, () => {
      updateModeUI("whitelist");
      chrome.storage.local.get(["customWhitelist"], (res) => renderDomainList(res.customWhitelist || []));
    });
  });

  if (addDomainBtn) {
    addDomainBtn.addEventListener("click", () => {
      const val = domainInput.value.trim().toLowerCase();
      if (!val) return;

      chrome.storage.local.get(["filterMode", "customBlacklist", "customWhitelist"], (data) => {
        const mode = data.filterMode || "blocklist";
        const key = mode === "blocklist" ? "customBlacklist" : "customWhitelist";
        const list = data[key] || [];

        if (!list.includes(val)) {
          list.push(val);
          chrome.storage.local.set({ [key]: list, settingsLastUpdated: Date.now() }, () => {
            domainInput.value = "";
            renderDomainList(list);
          });
        }
      });
    });
  }
}

function updateModeUI(mode) {
  const modeBlocklistBtn = document.getElementById("modeBlocklistBtn");
  const modeWhitelistBtn = document.getElementById("modeWhitelistBtn");
  const title = document.getElementById("domainSectionTitle");
  const subtext = document.getElementById("domainSectionSubtext");

  if (mode === "blocklist") {
    modeBlocklistBtn.classList.add("active");
    modeWhitelistBtn.classList.remove("active");
    if (title) title.textContent = "🚫 CUSTOM BLOCKLIST";
    if (subtext) subtext.textContent = "Explicitly listed domains will be intercepted.";
  } else {
    modeWhitelistBtn.classList.add("active");
    modeBlocklistBtn.classList.remove("active");
    if (title) title.textContent = "✅ CUSTOM WHITELIST";
    if (subtext) subtext.textContent = "Only explicitly listed domains will be accessible.";
  }
}

function renderDomainList(list) {
  const domainView = document.getElementById("domainView");
  if (!domainView) return;

  domainView.innerHTML = "";
  if (list.length === 0) {
    domainView.innerHTML = `<li style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">No custom rules added.</li>`;
    return;
  }

  list.forEach((domain, idx) => {
    const li = document.createElement("li");
    li.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 11px; border-bottom: 1px solid #e9ecef;";
    li.innerHTML = `
      <span>${domain}</span>
      <button data-idx="${idx}" style="background: none; border: none; color: #dc3545; cursor: pointer; font-weight: bold;">✕</button>
    `;

    li.querySelector("button").addEventListener("click", () => {
      chrome.storage.local.get(["filterMode", "customBlacklist", "customWhitelist"], (data) => {
        const mode = data.filterMode || "blocklist";
        const key = mode === "blocklist" ? "customBlacklist" : "customWhitelist";
        const currentList = data[key] || [];

        currentList.splice(idx, 1);
        chrome.storage.local.set({ [key]: currentList, settingsLastUpdated: Date.now() }, () => {
          renderDomainList(currentList);
        });
      });
    });

    domainView.appendChild(li);
  });
}