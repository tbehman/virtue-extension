import { DEFAULT_BLOCKLIST } from './defaultBlocklist.js';
import { COMPILED_KEYWORD_REGEXES } from './defaultKeywords.js';

// ==========================================
// 4. HIGH-PERFORMANCE INTERCEPTION ENGINE
// ==========================================
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; 
  const urlStr = details.url;
  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) return;
  if (urlStr.includes("virtue_bypass=true")) return;

  chrome.storage.local.get({ filterMode: "blocklist", customBlacklist: [], customWhitelist: [], customKeywords: [] }, (settings) => {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase().trim();
      const searchQuery = extractSearchQuery(urlStr);
      const isYahooMediaLeak = hostname.startsWith("images.search.yahoo.com") || hostname.startsWith("video.search.yahoo.com");

      let shouldBlock = false;
      let blockReason = "domain";

      // Helper function for custom blacklist/whitelist matching
      const matchesCustomList = (domainList) => {
        return domainList.some(domain => {
          const cleanDomain = domain.toLowerCase().trim();
          return hostname === cleanDomain || hostname.endsWith("." + cleanDomain);
        });
      };

      // 1. SEQUENCE CHECK 1: Custom Whitelist (Fastest Bypass)
      if (settings.filterMode === "whitelist") {
        shouldBlock = !matchesCustomList(settings.customWhitelist);
      } else {
        // 2. SEQUENCE CHECK 2: Custom Blacklist
        const inCustomBlacklist = matchesCustomList(settings.customBlacklist);

        // 3. SEQUENCE CHECK 3: O(1) 114k+ Static Domain Blocklist
        let inStaticShield = false;
        const parts = hostname.split('.');
        for (let i = 0; i < parts.length - 1; i++) {
          const rootDomain = parts.slice(i).join('.');
          if (DEFAULT_BLOCKLIST.has(rootDomain)) {
            inStaticShield = true;
            break;
          }
        }

        shouldBlock = inCustomBlacklist || inStaticShield || isYahooMediaLeak;

        // 4. SEQUENCE CHECK 4: Keyword & Regex Pattern Match (Full URL + Search Engine Query)
        if (!shouldBlock) {
          // Normalize text: combine full decoded URL and search query for evaluation
          const decodedUrl = decodeURIComponent(urlStr).toLowerCase();
          const targetText = searchQuery ? `${decodedUrl} ${searchQuery.toLowerCase()}` : decodedUrl;

          // User custom keywords from local storage
          const userKeywords = (settings.customKeywords || []).map(k => {
            try { return new RegExp(`\\b${k.trim()}\\b`, 'i'); } catch (e) { return null; }
          }).filter(Boolean);

          const allRegexes = [...COMPILED_KEYWORD_REGEXES, ...userKeywords];

          for (const regex of allRegexes) {
            if (regex.test(targetText)) {
              shouldBlock = true;
              blockReason = "keyword";
              break;
            }
          }
        }
      }

      // Trigger Block Page Redirect
      if (shouldBlock) {
        const blockPageUrl = chrome.runtime.getURL(
          `blocked.html?target=${encodeURIComponent(urlStr)}&reason=${blockReason}`
        );
        chrome.tabs.update(details.tabId, { url: blockPageUrl });
      }
    } catch (e) { console.error("Interception error:", e); }
  });
});