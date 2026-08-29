// app.js
let allLogs = [];
let showAllSearches = false;

// 1. Extract Drive File ID from URL parameter (e.g., ?fileId=XYZ)
const urlParams = new URLSearchParams(window.location.search);
const fileId = urlParams.get("fileId");

if (fileId) {
  fetchDriveLogs(fileId);
} else {
  console.log("No fileId found in URL parameters.");
}

function fetchDriveLogs(id) {
  fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
    .then(res => res.json())
    .then(data => renderDashboard(data))
    .catch(err => console.error("Error loading log file:", err));
}

function renderDashboard(data) {
  allLogs = data.logs || [];
  const profile = data.metadata || {};

  document.getElementById("userName").textContent = profile.userName || "User";

  // Compute Active Days (Unique days with logs in last 7 days)
  const uniqueDays = new Set(allLogs.map(l => new Date(l.timestamp).toDateString()));
  document.getElementById("activeDays").textContent = `${uniqueDays.size} / 7`;

  // 1. Process Flagged / Bypassed Hits
  const flaggedEvents = allLogs.filter(l => 
    (l.title && l.title.includes("[VISITED]")) || 
    (l.url && l.url.includes("virtue_bypass=true")) ||
    l.flagged === true
  );

  const attentionBox = document.getElementById("attentionBox");
  const flaggedList = document.getElementById("flaggedList");
  const statusBadge = document.getElementById("statusBadge");

  document.getElementById("flaggedCount").textContent = flaggedEvents.length;

  if (flaggedEvents.length > 0) {
    statusBadge.className = "status-badge status-flagged";
    statusBadge.textContent = `🔴 ${flaggedEvents.length} ITEM(S) NEED REVIEW`;
    attentionBox.classList.remove("hidden");
    flaggedList.innerHTML = flaggedEvents.map(e => `
      <li>
        <strong>[${new Date(e.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}]</strong> 
        <span>${e.title || "Flagged Event"}</span> ➔ 
        <a href="${e.url}" target="_blank">${e.url}</a>
      </li>
    `).join('');
  } else {
    statusBadge.className = "status-badge status-clear";
    statusBadge.textContent = "🟢 ALL CLEAR";
    attentionBox.classList.add("hidden");
  }

  // 2. Render Search Engine Queries (Time First, Truncated to 10)
  const searchQueries = allLogs.filter(l => l.searchQuery && l.searchQuery.trim() !== "" && l.searchQuery.toUpperCase() !== "N/A");
  document.getElementById("searchesCount").textContent = searchQueries.length;
  renderSearches(searchQueries);

  // 3. Render Top Domains (Left Side)
  renderTopDomains(allLogs);

  // 4. Render Full History Accordions (Bottom Section)
  renderFullHistory(allLogs);
}

function renderSearches(queries) {
  const searchesList = document.getElementById("searchesList");
  const toggleBtn = document.getElementById("toggleSearchesBtn");

  if (queries.length === 0) {
    searchesList.innerHTML = "<li>No searches recorded</li>";
    toggleBtn.classList.add("hidden");
    return;
  }

  const visibleQueries = showAllSearches ? queries : queries.slice(0, 10);
  
  searchesList.innerHTML = visibleQueries.map(q => `
    <li>
      <span class="time-col">[${new Date(q.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}]</span>
      <span class="query-text">"${q.searchQuery}"</span>
    </li>
  `).join('');

  if (queries.length > 10) {
    toggleBtn.classList.remove("hidden");
    toggleBtn.textContent = showAllSearches ? "▲ Show Less" : `▼ Show All ${queries.length} Searches`;
  } else {
    toggleBtn.classList.add("hidden");
  }
}

document.getElementById("toggleSearchesBtn").addEventListener("click", () => {
  showAllSearches = !showAllSearches;
  const searchQueries = allLogs.filter(l => l.searchQuery && l.searchQuery.trim() !== "" && l.searchQuery.toUpperCase() !== "N/A");
  renderSearches(searchQueries);
});

function renderTopDomains(logs) {
  const domainCounts = {};
  logs.forEach(l => {
    try {
      if (l.url && l.url.startsWith("http")) {
        const domain = new URL(l.url).hostname.replace('www.', '');
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      }
    } catch(e) {}
  });

  const sorted = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById("domainsCount").textContent = Object.keys(domainCounts).length;

  const topList = document.getElementById("topDomainsList");
  topList.innerHTML = sorted.map(([domain, count]) => `
    <li>
      <span class="domain-name"><strong>${domain}</strong></span>
      <span class="visit-count">${count} visits</span>
    </li>
  `).join('');
}

function renderFullHistory(logs) {
  const container = document.getElementById("fullHistoryContainer");
  const viewMode = document.getElementById("groupViewSelect").value;
  const sortMode = document.getElementById("sortSelect").value;

  if (viewMode === "grouped") {
    const groups = {};
    logs.forEach(l => {
      try {
        const domain = new URL(l.url).hostname.replace('www.', '');
        if (!groups[domain]) groups[domain] = [];
        groups[domain].push(l);
      } catch(e) {}
    });

    let sortedDomains = Object.entries(groups);
    if (sortMode === "most_visited") {
      sortedDomains.sort((a, b) => b[1].length - a[1].length);
    } else if (sortMode === "newest") {
      sortedDomains.sort((a, b) => new Date(b[1][b[1].length - 1].timestamp) - new Date(a[1][a[1].length - 1].timestamp));
    } else if (sortMode === "oldest") {
      sortedDomains.sort((a, b) => new Date(a[1][0].timestamp) - new Date(b[1][0].timestamp));
    }

    container.innerHTML = sortedDomains.map(([domain, items]) => `
      <details class="domain-accordion">
        <summary class="accordion-header">
          <strong>${domain}</strong>
          <span class="accordion-meta">${items.length} Visits</span>
        </summary>
        <ul class="accordion-child-list">
          ${items.map(item => `
            <li>
              <span class="time-col">[${new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}]</span>
              <a href="${item.url}" target="_blank">${item.title || item.url}</a>
            </li>
          `).join('')}
        </ul>
      </details>
    `).join('');
  }
}

document.getElementById("groupViewSelect").addEventListener("change", () => renderFullHistory(allLogs));
document.getElementById("sortSelect").addEventListener("change", () => renderFullHistory(allLogs));