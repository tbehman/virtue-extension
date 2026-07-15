document.addEventListener("DOMContentLoaded", () => {
  // Elements for URL Management
  const webhookUrlInput = document.getElementById('webhookUrl');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  // Strategy Mode Selector
  const filterModeSelect = document.getElementById("filterModeSelect");
  const whitelistPanel = document.getElementById("whitelistPanel");
  const blacklistPanel = document.getElementById("blacklistPanel");

  // Whitelist Elements
  const domainInput = document.getElementById("domainInput");
  const addBtn = document.getElementById("addBtn");
  const whitelistView = document.getElementById("whitelistView");

  // Blacklist Elements
  const blacklistInput = document.getElementById("blacklistInput");
  const addBlacklistBtn = document.getElementById("addBlacklistBtn");
  const blacklistView = document.getElementById("blacklistView");
  const explicitToggle = document.getElementById("explicitToggle");
  const gamblingToggle = document.getElementById("gamblingToggle");
  const violenceToggle = document.getElementById("violenceToggle");

  // ==========================================
  // 1. GOOGLE SHEET URL ENGINE
  // ==========================================
  saveBtn.addEventListener('click', () => {
    const url = webhookUrlInput.value.trim();
    chrome.storage.local.set({ webhookUrl: url }, () => {
      status.style.color = "green";
      status.textContent = ' Saved!';
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });

  // ==========================================
  // 2. STRATEGY MODE ENGINE (Dynamic Panel Swap)
  // ==========================================
  filterModeSelect.addEventListener("change", () => {
    const selectedMode = filterModeSelect.value;
    chrome.storage.local.set({ filterMode: selectedMode }, () => {
      updatePanelVisibility(selectedMode);
    });
  });

  function updatePanelVisibility(mode) {
    if (mode === "whitelist") {
      whitelistPanel.classList.remove("hidden");
      blacklistPanel.classList.add("hidden");
      loadWhitelist();
    } else {
      whitelistPanel.classList.add("hidden");
      blacklistPanel.classList.remove("hidden");
      loadBlacklist();
      loadCategoryToggles();
    }
  }

  // ==========================================
  // 3. WHITELIST PANEL ENGINE
  // ==========================================
  function loadWhitelist() {
    chrome.storage.local.get({ customWhitelist: [] }, (result) => {
      whitelistView.innerHTML = "";
      result.customWhitelist.forEach((domain) => {
        const li = document.createElement("li");
        li.textContent = domain;
        const delBtn = document.createElement("button");
        delBtn.textContent = "Remove";
        delBtn.className = "delete-btn";
        delBtn.addEventListener("click", () => removeDomain(domain, true));
        li.appendChild(delBtn);
        whitelistView.appendChild(li);
      });
    });
  }

  function addDomain(isWhitelist) {
    const inputEl = isWhitelist ? domainInput : blacklistInput;
    const storageKey = isWhitelist ? "customWhitelist" : "customBlacklist";
    const rawInput = inputEl.value.trim().toLowerCase();
    if (!rawInput) return;

    let cleanDomain = rawInput;
    try {
      if (rawInput.startsWith("http://") || rawInput.startsWith("https://")) {
        cleanDomain = new URL(rawInput).hostname;
      }
    } catch (e) {}

    chrome.storage.local.get({ [storageKey]: [] }, (result) => {
      const currentList = result[storageKey];
      if (!currentList.includes(cleanDomain)) {
        currentList.push(cleanDomain);
        chrome.storage.local.set({ [storageKey]: currentList }, () => {
          inputEl.value = "";
          isWhitelist ? loadWhitelist() : loadBlacklist();
        });
      }
    });
  }

  function removeDomain(domainToRemove, isWhitelist) {
    const storageKey = isWhitelist ? "customWhitelist" : "customBlacklist";
    chrome.storage.local.get({ [storageKey]: [] }, (result) => {
      const updatedList = result[storageKey].filter(d => d !== domainToRemove);
      chrome.storage.local.set({ [storageKey]: updatedList }, () => {
        isWhitelist ? loadWhitelist() : loadBlacklist();
      });
    });
  }

  // ==========================================
  // 4. BLACKLIST PANEL ENGINE
  // ==========================================
  function loadBlacklist() {
    chrome.storage.local.get({ customBlacklist: [] }, (result) => {
      blacklistView.innerHTML = "";
      result.customBlacklist.forEach((domain) => {
        const li = document.createElement("li");
        li.textContent = domain;
        const delBtn = document.createElement("button");
        delBtn.textContent = "Remove";
        delBtn.className = "delete-btn";
        delBtn.addEventListener("click", () => removeDomain(domain, false));
        li.appendChild(delBtn);
        blacklistView.appendChild(li);
      });
    });
  }

  function loadCategoryToggles() {
    chrome.storage.local.get({
      filterExplicit: false,
      filterGambling: false,
      filterViolence: false
    }, (result) => {
      explicitToggle.checked = result.filterExplicit;
      gamblingToggle.checked = result.filterGambling;
      violenceToggle.checked = result.filterViolence;
    });
  }

  // Save category toggles on click
  const bindToggle = (element, storageKey) => {
    element.addEventListener("change", () => {
      chrome.storage.local.set({ [storageKey]: element.checked });
    });
  };
  bindToggle(explicitToggle, "filterExplicit");
  bindToggle(gamblingToggle, "filterGambling");
  bindToggle(violenceToggle, "filterViolence");

  // ==========================================
  // 5. INITIALIZATION RULES
  // ==========================================
  addBtn.addEventListener("click", () => addDomain(true));
  domainInput.addEventListener("keypress", (e) => { if (e.key === "Enter") addDomain(true); });

  addBlacklistBtn.addEventListener("click", () => addDomain(false));
  blacklistInput.addEventListener("keypress", (e) => { if (e.key === "Enter") addDomain(false); });

  // Load configuration base state on window open
  chrome.storage.local.get({ webhookUrl: '', filterMode: 'whitelist' }, (data) => {
    if (data.webhookUrl) webhookUrlInput.value = data.webhookUrl;
    filterModeSelect.value = data.filterMode;
    updatePanelVisibility(data.filterMode);
  });
});