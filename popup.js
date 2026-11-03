import { deriveKeyFromPin } from './cryptoUtils.js';

// Centralized constants for high cohesion and zero magic strings
const FILTER_MODE_STANDARD = "standard";
const FILTER_MODE_STRICT = "strict";

document.addEventListener("DOMContentLoaded", () => {
  // Detect non-Chrome Chromium browsers (Edge, Brave, Opera, etc.)
  const isNonChromeChromium = /Edg|OPR|Brave/.test(navigator.userAgent) || !/Chrome/.test(navigator.userAgent);

  const warningCard = document.getElementById("browserWarningCard");
  const setupScreen = document.getElementById("setupScreen");
  const dashboardScreen = document.getElementById("dashboardScreen");
  const settingsScreen = document.getElementById("settingsScreen");

  if (isNonChromeChromium) {
    toggleHidden(warningCard, false); // Reveal warning banner
    toggleHidden(setupScreen, true);
    toggleHidden(dashboardScreen, true);
    toggleHidden(settingsScreen, true);
    return; // Halt further initialization on non-Chrome browsers
  } else {
    toggleHidden(warningCard, true);
  }

  initPopup();
});

function toggleHidden(element, isHidden) {
  if (!element) return;
  if (isHidden) {
    element.classList.add("hidden");
    element.style.display = "none";
  } else {
    element.classList.remove("hidden");
    element.style.display = "block";
  }
}

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
    const settingsScreen = document.getElementById("settingsScreen");
    const authStepContainer = document.getElementById("authStepContainer");
    const profileFormFields = document.getElementById("profileFormFields");

    if (data.userEmail && data.partnerEmail && data.userPin) {
      toggleHidden(setupScreen, true);
      toggleHidden(settingsScreen, true);
      toggleHidden(dashboardScreen, false);

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
      toggleHidden(dashboardScreen, true);
      toggleHidden(settingsScreen, true);
      toggleHidden(setupScreen, false);

      if (data.userEmail) {
        toggleHidden(authStepContainer, true);
        toggleHidden(profileFormFields, false);
      } else {
        toggleHidden(authStepContainer, false);
        toggleHidden(profileFormFields, true);
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
          toggleHidden(pinPromptArea, false);
          if (verifyPinInput) {
            verifyPinInput.value = "";
            verifyPinInput.focus();
          }
        } else {
          toggleHidden(dashboardScreen, true);
          toggleHidden(settingsScreen, false);
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
          toggleHidden(pinPromptArea, true);
          toggleHidden(dashboardScreen, true);
          toggleHidden(settingsScreen, false);
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
      toggleHidden(pinPromptArea, true);
      if (verifyPinInput) verifyPinInput.value = "";
    });
  }

  // Return to Dashboard & Re-lock Settings
  if (backToDashboardBtn) {
    backToDashboardBtn.addEventListener("click", () => {
      toggleHidden(settingsScreen, true);
      toggleHidden(dashboardScreen, false);
      toggleHidden(pinPromptArea, true);
      loadProfileAndRender();
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
            profileStatusText.textContent = "Profile saved successfully!";
            profileStatusText.style.display = "block";

            setTimeout(() => {
              profileStatusText.style.display = "none";
            }, 3500);
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
      toggleHidden(forgotPinModal, false);
    });
  }

  if (closeForgotPinBtn) {
    closeForgotPinBtn.addEventListener("click", () => {
      toggleHidden(forgotPinModal, true);
    });
  }

  if (sendRecoveryEmailBtn) {
    sendRecoveryEmailBtn.addEventListener("click", () => {
      sendRecoveryEmailBtn.disabled = true;
      sendRecoveryEmailBtn.textContent = "Sending...";

      chrome.runtime.sendMessage({ type: "RECOVER_USER_PIN" }, (response) => {
        sendRecoveryEmailBtn.disabled = false;
        sendRecoveryEmailBtn.textContent = "Send Email";
        toggleHidden(forgotPinModal, true);

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
  const modeStandardRadio = document.querySelector('input[name="filterModeRadio"][value="standard"]');
  const modeStrictRadio = document.querySelector('input[name="filterModeRadio"][value="strict"]');
  const modeBlocklistBtn = document.getElementById("modeBlocklistBtn");
  const modeApprovedListBtn = document.getElementById("modeApprovedListBtn");
  const addDomainBtn = document.getElementById("addDomainBtn");
  const domainInput = document.getElementById("domainInput");

  if (!modeStandardRadio || !modeBlocklistBtn) return;

  // Track active list view tab ("blocklist" or "approved")
  let activeListTab = "blocklist";

  chrome.storage.local.get(["filterMode", "customBlocklist", "customApprovedList"], (data) => {
    const currentMode = data.filterMode || FILTER_MODE_STANDARD;

    if (modeStandardRadio && modeStrictRadio) {
      modeStandardRadio.checked = (currentMode === FILTER_MODE_STANDARD);
      modeStrictRadio.checked = (currentMode === FILTER_MODE_STRICT);
    }

    // Automatically default to Approved List if Strict mode is active
    if (currentMode === FILTER_MODE_STRICT) {
      activeListTab = "approved";
      modeApprovedListBtn.classList.add("active");
      modeBlocklistBtn.classList.remove("active");
      updateListHeaders("approved");
      renderDomainList(data.customApprovedList || [], "approved");
    } else {
      activeListTab = "blocklist";
      modeBlocklistBtn.classList.add("active");
      modeApprovedListBtn.classList.remove("active");
      updateListHeaders("blocklist");
      renderDomainList(data.customBlocklist || [], "blocklist");
    }
  });

  // Global Mode Radio Listeners
  if (modeStandardRadio) {
    modeStandardRadio.addEventListener("change", () => {
      if (modeStandardRadio.checked) {
        chrome.storage.local.set({ filterMode: FILTER_MODE_STANDARD, settingsLastUpdated: Date.now() });
        // Switch back to blocklist view when returning to standard
        activeListTab = "blocklist";
        modeBlocklistBtn.classList.add("active");
        modeApprovedListBtn.classList.remove("active");
        updateListHeaders("blocklist");
        chrome.storage.local.get(["customBlocklist"], (res) => renderDomainList(res.customBlocklist || [], "blocklist"));
      }
    });
  }

  if (modeStrictRadio) {
    modeStrictRadio.addEventListener("change", () => {
      if (modeStrictRadio.checked) {
        chrome.storage.local.set({ filterMode: FILTER_MODE_STRICT, settingsLastUpdated: Date.now() });
        // Automatically slide over to approved list view when switching to strict
        activeListTab = "approved";
        modeApprovedListBtn.classList.add("active");
        modeBlocklistBtn.classList.remove("active");
        updateListHeaders("approved");
        chrome.storage.local.get(["customApprovedList"], (res) => renderDomainList(res.customApprovedList || [], "approved"));
      }
    });
  }

  // List View Tab Switchers
  if (modeBlocklistBtn && modeApprovedListBtn) {
    modeBlocklistBtn.addEventListener("click", () => {
      activeListTab = "blocklist";
      modeBlocklistBtn.classList.add("active");
      modeApprovedListBtn.classList.remove("active");
      updateListHeaders(activeListTab);
      chrome.storage.local.get(["customBlocklist"], (res) => renderDomainList(res.customBlocklist || [], activeListTab));
    });

    modeApprovedListBtn.addEventListener("click", () => {
      activeListTab = "approved";
      modeApprovedListBtn.classList.add("active");
      modeBlocklistBtn.classList.remove("active");
      updateListHeaders(activeListTab);
      chrome.storage.local.get(["customApprovedList"], (res) => renderDomainList(res.customApprovedList || [], activeListTab));
    });
  }

  if (addDomainBtn) {
    addDomainBtn.addEventListener("click", () => {
      const val = domainInput.value.trim().toLowerCase();
      if (!val) return;

      chrome.storage.local.get(["customBlocklist", "customApprovedList"], (data) => {
        const key = activeListTab === "blocklist" ? "customBlocklist" : "customApprovedList";
        const list = data[key] || [];

        if (!list.includes(val)) {
          list.push(val);
          chrome.storage.local.set({ [key]: list, settingsLastUpdated: Date.now() }, () => {
            domainInput.value = "";
            renderDomainList(list, activeListTab);
          });
        }
      });
    });
  }
}

function updateListHeaders(tabType) {
  const title = document.getElementById("domainSectionTitle");
  const subtext = document.getElementById("domainSectionSubtext");

  if (tabType === "blocklist") {
    if (title) title.textContent = "🚫 BLOCKLIST";
    if (subtext) subtext.textContent = "Explicitly listed domains will be intercepted.";
  } else {
    if (title) title.textContent = "✅ APPROVED LIST";
    if (subtext) subtext.textContent = "Sites that always bypass blocklist and keyword filters.";
  }
}

function renderDomainList(list, tabType) {
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
      const key = tabType === "blocklist" ? "customBlocklist" : "customApprovedList";
      chrome.storage.local.get([key], (data) => {
        const currentList = data[key] || [];
        currentList.splice(idx, 1);
        chrome.storage.local.set({ [key]: currentList, settingsLastUpdated: Date.now() }, () => {
          renderDomainList(currentList, tabType);
        });
      });
    });

    domainView.appendChild(li);
  });
}