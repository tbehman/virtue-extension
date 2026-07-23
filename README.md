# 🛡️ Virtue Accountability Extension

**Virtue** is an open-source, serverless browser extension designed for personal accountability and family protection. It enforces strict web guardrails and logs intent transparently using **Google Sheets** as a live, private reporting portal.

---

## ✨ Core Features

* **Transparent Intent Tracking:** Automatically captures search engine queries (Google, Bing, DuckDuckGo) and web navigation to record genuine intent.
* **Dual Protection Strategies:**
  * 🛡️ **Custom Blocklist Mode:** Keeps the internet open while intercepting specified domains.
  * 🏰 **Whitelist Only Mode:** Locks down the browser into a "walled garden" (Library Mode), allowing only explicitly trusted domains.
* **Grace & Truth Interception:** When a restricted site is reached, users are met with a decision screen (`blocked.html`):
  * **Grace:** Close the tab to turn back without generating a violation log.
  * **Truth:** Enter the 4-digit Master PIN to proceed; overrides and failed attempts are recorded directly to the dashboard.
* **Bake-In Shields:** Forces strict SafeSearch parameters across major search engines.
* **Serverless Architecture:** Stores all telemetry directly in your personal Google Drive spreadsheet—no third-party databases, subscriptions, or external servers required.

---

## 🛠️ Security & Privacy

* **4-Digit Master PIN:** Access to settings, domain rule edits, and portal management is locked behind a PIN.
* **Strict Reset Policy:** To prevent unauthorized bypasses, there is no in-app PIN reset loop. Resetting requires uninstalling and reinstalling the extension, which immediately flags accountability partners.
* **Self-Healing Google Auth:** Uses OAuth2 tokens to maintain uninterrupted background syncing and auto-reconnects to existing spreadsheets without generating duplicate files.

---

## 🚀 Getting Started (Developer Setup)

1. **Clone the Repository:**
   ```bash
   git clone [https://github.com/YOUR_USERNAME/virtue-extension.git](https://github.com/YOUR_USERNAME/virtue-extension.git)
   cd virtue-extension

   Configure Google OAuth2:

2. Create a project in the Google Cloud Console.
  Enable the Google Sheets API and Google Drive API.
  Create an OAuth 2.0 Client ID for a Chrome Extension.
  Add your client_id to manifest.json.
  Load in Chrome:
  Open Chrome and navigate to chrome://extensions.
  Enable Developer mode in the top-right corner.
  Click Load unpacked and select the virtue-extension root directory.

📋 Technology Stack
Frontend: HTML5, CSS3, JavaScript (ES6+ Modules)

API Framework: Chrome Extension Manifest V3 (declarativeNetRequest, webNavigation, identity)

Database & Reporting Engine: Google Sheets API v4 / Google Drive API v3

📄 License
This project is open-source under the MIT License.
