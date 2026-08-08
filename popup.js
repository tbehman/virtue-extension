document.addEventListener("DOMContentLoaded", () => {
  // Screens
  const setupScreen = document.getElementById("setupScreen");
  const dashboardScreen = document.getElementById("dashboardScreen");
  const settingsScreen = document.getElementById("settingsScreen");

  // Onboarding UI Containers
  const authStepContainer = document.getElementById("authStepContainer");
  const profileFormFields = document.getElementById("profileFormFields");
  const existingVaultNotice = document.getElementById("existingVaultNotice");
  const existingVaultText = document.getElementById("existingVaultText");
  const userNameGroup = document.getElementById("userNameGroup");
  const partnerNameGroup = document.getElementById("partnerNameGroup");
  const partnerEmailGroup = document.getElementById("partnerEmailGroup");

  // Onboarding Inputs & Buttons
  const userNameInput = document.getElementById("userNameInput");
  const partnerNameInput = document.getElementById("partnerNameInput");
  const partnerEmailInput = document.getElementById("partnerEmailInput");
  const masterPinInput = document.getElementById("masterPinInput");
  const pinLabelText = document.getElementById("pinLabelText");
  const authGoogleBtn = document.getElementById("authGoogleBtn");
  const completeSetupBtn = document.getElementById("completeSetupBtn");
  const status = document.getElementById("status");

  // Settings Profile Form
  const editUserNameInput = document.getElementById("editUserNameInput");
  const editPartnerNameInput = document.getElementById("editPartnerNameInput");
  const editPartnerEmailInput = document.getElementById("editPartnerEmailInput");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const profileStatusText = document.getElementById("profileStatusText");

  // Dashboard & Status
  const accountDisplay = document.getElementById("accountDisplay");
  const refreshAccountBtn = document.getElementById("refreshAccountBtn");
  const partnerDisplayEmail = document.getElementById("partnerDisplayEmail");
  const viewSheetLink = document.getElementById("viewSheetLink");
  const openSettingsBtn = document.getElementById("openSettingsBtn");

  // Settings Storage Section Elements
  const settingsUserEmail = document.getElementById("settingsUserEmail");
  const disclaimerPartnerEmail = document.getElementById("disclaimerPartnerEmail");
  const switchStorageAccountBtn = document.getElementById("switchStorageAccountBtn");

  // Settings & PIN Controls
  const pinPromptArea = document.getElementById("pinPromptArea");
  const verifyPinInput = document.getElementById("verifyPinInput");
  const submitPinBtn = document.getElementById("submitPinBtn");
  const cancelPinBtn = document.getElementById("cancelPinBtn");
  const backToDashboardBtn = document.getElementById("backToDashboardBtn");
  const modeBlocklistBtn = document.getElementById("modeBlocklistBtn");
  const modeWhitelistBtn = document.getElementById("modeWhitelistBtn");
  const domainSectionTitle = document.getElementById("domainSectionTitle");
  const domainSectionSubtext = document.getElementById("domainSectionSubtext");
  const domainInput = document.getElementById("domainInput");
  const addDomainBtn = document.getElementById("addDomainBtn");
  const domainView = document.getElementById("domainView");
  const forgotPinLink = document.getElementById("forgotPinLink");
  const forgotPinModal = document.getElementById("forgotPinModal");
  const closeForgotPinBtn = document.getElementById("closeForgotPinBtn");

  let isUnlocked = false;
  let cachedPin = "";
  let activeFilterMode = "blocklist";
  let activeAuthToken = null;
  let activeUserEmail = null;
  let discoveredVaultFileId = null;
  let discoveredProfile = null;

  const GITHUB_DASHBOARD_BASE_URL = "https://tbehman.github.io/virtue-extension/";

  // ==========================================
  // 1. INITIALIZATION ENGINE
  // ==========================================
  function init() {
    chrome.storage.local.get([
      "authToken",
      "userEmail",
      "partnerEmail",
      "userPin",
      "userName",
      "partnerName",
      "filterMode",
      "driveFileId"
    ], (data) => {
      cachedPin = data.userPin || "";
      activeFilterMode = data.filterMode || "blocklist";

      if (!data.authToken || !cachedPin) {
        setupScreen.classList.remove("hidden");
        dashboardScreen.classList.add("hidden");
        settingsScreen.classList.add("hidden");
        
        authStepContainer.classList.remove("hidden");
        profileFormFields.classList.add("hidden");
        existingVaultNotice.classList.add("hidden");
      } else {
        setupScreen.classList.add("hidden");
        dashboardScreen.classList.remove("hidden");
        settingsScreen.classList.add("hidden");
        pinPromptArea.classList.add("hidden");
        
        // Resolve Connected Account Email
        if (accountDisplay) {
          if (data.userEmail && data.userEmail.trim() !== "") {
            accountDisplay.textContent = data.userEmail.trim();
          } else {
            accountDisplay.textContent = "Loading...";
            fetchGoogleUserEmail(data.authToken, (email) => {
              accountDisplay.textContent = email || "Connected";
            });
          }
        }

        // Resolve Partner Email Display
        if (partnerDisplayEmail) {
          partnerDisplayEmail.textContent = (data.partnerEmail && data.partnerEmail.trim() !== "") 
            ? data.partnerEmail.trim() 
            : "Not Set";
        }
          
        // Resolve Web Dashboard Button Link
        if (data.driveFileId && viewSheetLink) {
          const dashboardUrl = `${GITHUB_DASHBOARD_BASE_URL}?fileId=${data.driveFileId}`;
          viewSheetLink.href = dashboardUrl;
        }
      }
    });
  }

  function fetchGoogleUserEmail(token, callback) {
    if (!token) return callback("");
    fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { "Authorization": `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(profile => {
      const email = profile.email || "";
      if (email) {
        activeUserEmail = email;
        chrome.storage.local.set({ userEmail: email });
      }
      callback(email);
    })
    .catch(() => callback(""));
  }

  if (refreshAccountBtn) {
    refreshAccountBtn.addEventListener("click", () => {
      if (accountDisplay) accountDisplay.textContent = "Loading...";
      chrome.storage.local.get(["authToken"], (data) => {
        if (data.authToken) {
          fetchGoogleUserEmail(data.authToken, (email) => {
            if (accountDisplay) accountDisplay.textContent = email || "Connected";
          });
        }
      });
    });
  }

  // ==========================================
  // 2. STEP 1: GOOGLE CONNECT & VAULT DISCOVERY
  // ==========================================
  authGoogleBtn.addEventListener("click", () => {
    status.style.color = "#4285F4";
    status.textContent = "Authenticating Google Account...";
    authGoogleBtn.disabled = true;

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        status.style.color = "#d93025";
        status.textContent = "Connection failed: " + (chrome.runtime.lastError?.message || "No response");
        authGoogleBtn.disabled = false;
        return;
      }

      activeAuthToken = token;
      status.textContent = "Retrieving profile details...";

      fetchGoogleUserEmail(token, (fetchedEmail) => {
        activeUserEmail = fetchedEmail;
        status.textContent = "Checking Google Drive for existing Virtue vault...";
        
        inspectDriveForVault(token, (vaultFound, fileData, fileId) => {
          authStepContainer.classList.add("hidden");
          profileFormFields.classList.remove("hidden");
          status.textContent = "";

          if (vaultFound && fileData && fileData.metadata) {
            discoveredVaultFileId = fileId;
            discoveredProfile = fileData.metadata;

            userNameGroup.classList.add("hidden");
            partnerNameGroup.classList.add("hidden");
            partnerEmailGroup.classList.add("hidden");

            const userFirstName = discoveredProfile.userName ? discoveredProfile.userName.split(" ")[0] : "User";
            existingVaultText.textContent = `👋 Welcome back, ${userFirstName}! Linked vault found for partner: ${discoveredProfile.partnerEmail || "Set"}`;
            existingVaultNotice.classList.remove("hidden");
            pinLabelText.textContent = "Enter your 4-Digit Master PIN to authorize this device:";
          } else {
            existingVaultNotice.classList.add("hidden");
            userNameGroup.classList.remove("hidden");
            partnerNameGroup.classList.remove("hidden");
            partnerEmailGroup.classList.remove("hidden");
            pinLabelText.textContent = "Create a 4-Digit Master PIN:";
          }
        });
      });
    });
  });

  function inspectDriveForVault(token, callback) {
    const query = encodeURIComponent("name = 'virtue_logs.json' and trashed = false");
    
    fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.files && data.files.length > 0) {
        const fileId = data.files[0].id;
        fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { "Authorization": `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(content => callback(true, content, fileId))
        .catch(() => callback(false, null, null));
      } else {
        callback(false, null, null);
      }
    })
    .catch(() => callback(false, null, null));
  }

  // ==========================================
  // 3. STEP 2: COMPLETE SETUP & PROVISION
  // ==========================================
  completeSetupBtn.addEventListener("click", () => {
    const pin = masterPinInput.value.trim();

    if (!/^\d{4}$/.test(pin)) {
      status.style.color = "#d93025";
      status.textContent = "PIN must be exactly 4 digits.";
      return;
    }

    status.style.color = "#4285F4";

    if (discoveredProfile) {
      status.textContent = "Authorizing device...";
      const storagePayload = {
        authToken: activeAuthToken,
        userEmail: activeUserEmail || discoveredProfile.userEmail || "",
        driveFileId: discoveredVaultFileId,
        userName: discoveredProfile.userName || "",
        partnerName: discoveredProfile.partnerName || "",
        partnerEmail: discoveredProfile.partnerEmail || "",
        userPin: pin,
        filterMode: "blocklist"
      };

      chrome.storage.local.set(storagePayload, () => init());
    } else {
      const email = partnerEmailInput.value.trim();
      const userName = userNameInput.value.trim();
      const partnerName = partnerNameInput.value.trim();

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        status.style.color = "#d93025";
        status.textContent = "Please enter a valid partner email address.";
        return;
      }

      status.textContent = "Creating secure Google Drive vault...";

      const profilePayload = { 
        userEmail: activeUserEmail || "", 
        userName, 
        partnerName, 
        partnerEmail: email 
      };

      createNewDriveVault(activeAuthToken, profilePayload, (newFileId) => {
        const storagePayload = {
          authToken: activeAuthToken,
          userEmail: activeUserEmail || "",
          driveFileId: newFileId,
          userName,
          partnerName,
          partnerEmail: email,
          userPin: pin,
          filterMode: "blocklist"
        };

        chrome.storage.local.set(storagePayload, () => init());
      });
    }
  });

  function createNewDriveVault(token, profile, callback) {
    const metadata = { name: "virtue_logs.json", mimeType: "application/json" };
    const initialContent = JSON.stringify({
      metadata: {
        version: "1.0",
        userEmail: profile.userEmail || "",
        userName: profile.userName || "",
        partnerName: profile.partnerName || "",
        partnerEmail: profile.partnerEmail || "",
        filterMode: "blocklist",
        customBlacklist: [],
        customWhitelist: []
      },
      logs: []
    });

    fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${token}`, 
        "Content-Type": "multipart/related; boundary=virtue_boundary" 
      },
      body: `--virtue_boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--virtue_boundary\r\nContent-Type: application/json\r\n\r\n${initialContent}\r\n--virtue_boundary--`
    })
    .then(res => res.json())
    .then(newFile => callback(newFile ? newFile.id : null))
    .catch(() => callback(null));
  }

  // ==========================================
  // 4. SETTINGS NAVIGATION & PROFILE EDITING
  // ==========================================
  openSettingsBtn.addEventListener("click", () => {
    if (isUnlocked) {
      showSettingsScreen();
    } else {
      pinPromptArea.classList.remove("hidden");
      verifyPinInput.value = "";
      verifyPinInput.focus();
    }
  });

  cancelPinBtn.addEventListener("click", () => pinPromptArea.classList.add("hidden"));

  submitPinBtn.addEventListener("click", () => {
    if (verifyPinInput.value.trim() === cachedPin) {
      isUnlocked = true;
      pinPromptArea.classList.add("hidden");
      showSettingsScreen();
    } else {
      alert("Incorrect 4-Digit PIN.");
    }
  });

  backToDashboardBtn.addEventListener("click", () => {
    settingsScreen.classList.add("hidden");
    dashboardScreen.classList.remove("hidden");
    init();
  });

  function showSettingsScreen() {
    dashboardScreen.classList.add("hidden");
    settingsScreen.classList.remove("hidden");

    chrome.storage.local.get(["userName", "partnerName", "partnerEmail", "userEmail"], (data) => {
      editUserNameInput.value = data.userName || "";
      editPartnerNameInput.value = data.partnerName || "";
      editPartnerEmailInput.value = data.partnerEmail || "";

      if (settingsUserEmail) settingsUserEmail.textContent = data.userEmail || "Connected Google Account";
      if (disclaimerPartnerEmail) disclaimerPartnerEmail.textContent = data.partnerEmail || "Partner";
    });

    updateFilterModeUI();
    loadDomainList();
  }

  saveProfileBtn.addEventListener("click", () => {
    const newUserName = editUserNameInput.value.trim();
    const newPartnerName = editPartnerNameInput.value.trim();
    const newPartnerEmail = editPartnerEmailInput.value.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newPartnerEmail)) {
      profileStatusText.style.color = "#d93025";
      profileStatusText.textContent = "Please enter a valid partner email.";
      profileStatusText.style.display = "block";
      return;
    }

    profileStatusText.style.color = "#1a73e8";
    profileStatusText.textContent = "Saving profile changes...";
    profileStatusText.style.display = "block";

    chrome.storage.local.get(["partnerEmail", "userName", "userEmail", "authToken", "driveFileId"], (currentData) => {
      const oldPartnerEmail = currentData.partnerEmail;
      const isEmailChanged = oldPartnerEmail && oldPartnerEmail.toLowerCase() !== newPartnerEmail.toLowerCase();

      const updatedPayload = {
        userName: newUserName,
        partnerName: newPartnerName,
        partnerEmail: newPartnerEmail,
        userEmail: currentData.userEmail || ""
      };

      chrome.storage.local.set(updatedPayload, () => {
        syncMetadataToDrive(currentData.authToken, currentData.driveFileId, updatedPayload, () => {
          if (isEmailChanged) {
            profileStatusText.style.color = "#129eaf";
            profileStatusText.textContent = "Profile saved! Courtesy alert sent to former partner.";
          } else {
            profileStatusText.style.color = "#188038";
            profileStatusText.textContent = "Profile saved successfully!";
          }

          if (disclaimerPartnerEmail) disclaimerPartnerEmail.textContent = newPartnerEmail;

          setTimeout(() => {
            profileStatusText.style.display = "none";
          }, 3500);
        });
      });
    });
  });

  function syncMetadataToDrive(token, fileId, newMetadata, callback) {
    if (!token || !fileId) return callback();

    fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(fullContent => {
      fullContent.metadata = {
        ...fullContent.metadata,
        userEmail: newMetadata.userEmail,
        userName: newMetadata.userName,
        partnerName: newMetadata.partnerName,
        partnerEmail: newMetadata.partnerEmail
      };

      fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fullContent)
      })
      .then(() => callback())
      .catch(() => callback());
    })
    .catch(() => callback());
  }

  // Switch Storage Account Handler
  if (switchStorageAccountBtn) {
    switchStorageAccountBtn.addEventListener("click", () => {
      chrome.storage.local.get(["partnerEmail"], (data) => {
        const pEmail = data.partnerEmail || "your partner";
        if (confirm(`Switching Google accounts will dispatch a security notification to ${pEmail} and reset storage connection on this device. Proceed?`)) {
          chrome.storage.local.get(["authToken"], (res) => {
            if (res.authToken) {
              chrome.identity.removeCachedAuthToken({ token: res.authToken }, () => {
                chrome.storage.local.clear(() => {
                  location.reload();
                });
              });
            } else {
              chrome.storage.local.clear(() => {
                location.reload();
              });
            }
          });
        }
      });
    });
  }

  forgotPinLink.addEventListener("click", (e) => {
    e.preventDefault();
    forgotPinModal.classList.remove("hidden");
  });

  closeForgotPinBtn.addEventListener("click", () => forgotPinModal.classList.add("hidden"));

  // ==========================================
  // 5. DOMAIN MANAGEMENT
  // ==========================================
  function updateFilterModeUI() {
    if (activeFilterMode === "whitelist") {
      modeWhitelistBtn.classList.add("active");
      modeBlocklistBtn.classList.remove("active");
      domainSectionTitle.textContent = "🏰 CUSTOM WHITELIST";
      domainSectionSubtext.textContent = "All websites blocked EXCEPT explicitly added domains.";
      domainInput.placeholder = "e.g., wikipedia.org";
    } else {
      modeBlocklistBtn.classList.add("active");
      modeWhitelistBtn.classList.remove("active");
      domainSectionTitle.textContent = "🚫 CUSTOM BLOCKLIST";
      domainSectionSubtext.textContent = "Explicitly listed domains will be intercepted.";
      domainInput.placeholder = "e.g., website.com";
    }
  }

  modeBlocklistBtn.addEventListener("click", () => {
    activeFilterMode = "blocklist";
    chrome.storage.local.set({ filterMode: "blocklist" }, () => {
      updateFilterModeUI();
      loadDomainList();
    });
  });

  modeWhitelistBtn.addEventListener("click", () => {
    activeFilterMode = "whitelist";
    chrome.storage.local.set({ filterMode: "whitelist" }, () => {
      updateFilterModeUI();
      loadDomainList();
    });
  });

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
        const delBtn = document.createElement("button");
        delBtn.textContent = "×";
        delBtn.className = "delete-btn";
        delBtn.addEventListener("click", () => removeDomain(domain, storageKey));
        li.appendChild(delBtn);
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
      chrome.storage.local.set({ [storageKey]: updatedList }, () => loadDomainList());
    });
  }

  addDomainBtn.addEventListener("click", addDomain);

  init();
});