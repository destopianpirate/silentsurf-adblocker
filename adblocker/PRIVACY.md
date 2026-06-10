# Privacy Policy for Destopian AdBlock Pro

**Effective Date:** June 10, 2026

At Destopian, we respect your privacy. This Privacy Policy details how we handle information in our Microsoft Edge extension, **Destopian AdBlock Pro**.

## 1. No Data Collection or Transmission
Destopian AdBlock Pro does **not** collect, store, track, transmit, or share any personal data, browsing history, or user information. All processes are executed locally on your device.

- We do not run any remote analytical trackers.
- We do not operate any external database servers.
- We do not share information with any third-party advertising or telemetry services.

## 2. Permissions Used & Purpose
Our extension requests specific permission scopes to enable its core blocking functionality. None of these permission scopes are used to extract or send personal data:
- **`declarativeNetRequest`**: Used exclusively to block ad-serving network requests locally before they load in your browser.
- **`storage`**: Used to save your extension configurations (such as your whitelisted sites list and custom blocking rules) locally within your browser's sandboxed storage.
- **`activeTab`**: Used to read the active website's domain only when you open the popup interface, enabling you to toggle the whitelist setting for that specific site.
- **`<all_urls>` (Host Permission)**: Required so that the ad-blocking rules can be parsed and executed on any website you browse. Without this, the extension cannot filter advertisements or trackers on external web pages.

## 3. Storage of Configurations
All configurations, such as your whitelist and custom rules lists, are saved locally on your device via Chrome’s sandboxed local storage API (`chrome.storage.local`). Clearing your browser cache or uninstalling the extension permanently removes this data.

## 4. Updates to this Policy
We may update our Privacy Policy from time to time. Any changes will be posted within the extension repository or documentation.

## 5. Contact Us
If you have any questions or concerns regarding this Privacy Policy, please contact the developer through the extension store support section.
