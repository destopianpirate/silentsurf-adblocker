// Background Service Worker for Destopian AdBlocker Pro (Manifest V3)

// Initialize extension settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['adBlockEnabled', 'whitelistedDomains', 'customRules', 'totalBlocked', 'tabStats']);
  
  const defaults = {
    adBlockEnabled: data.adBlockEnabled !== undefined ? data.adBlockEnabled : true,
    whitelistedDomains: data.whitelistedDomains || [],
    customRules: data.customRules || [],
    totalBlocked: data.totalBlocked || 0,
    tabStats: {}
  };

  await chrome.storage.local.set(defaults);
  
  await syncStaticRulesets();
  await syncDynamicRules();
});

// Reset session statistics on startup
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ tabStats: {} });
  await syncStaticRulesets();
  await syncDynamicRules();
});

// Helper: Enable/Disable the static ruleset
async function syncStaticRulesets() {
  const data = await chrome.storage.local.get('adBlockEnabled');
  const enabled = data.adBlockEnabled !== false;

  if (enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["ruleset_1"]
    });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["ruleset_1"]
    });
  }
}

// Helper: Sync dynamic rules for whitelisted domains and custom blocks
async function syncDynamicRules() {
  const data = await chrome.storage.local.get(['whitelistedDomains', 'customRules', 'adBlockEnabled']);
  const whitelisted = data.whitelistedDomains || [];
  const custom = data.customRules || [];
  const enabled = data.adBlockEnabled !== false;

  // Get all existing dynamic rules to clear them
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);

  const newRules = [];

  if (enabled) {
    // 1. Whitelist rules (IDs starting at 10000)
    // Uses allowAllRequests action to bypass any other matching block rules on these domains
    whitelisted.forEach((domain, index) => {
      newRules.push({
        id: 10000 + index,
        priority: 100, // High priority to override block rules
        action: { type: "allowAllRequests" },
        condition: {
          initiatorDomains: [domain],
          resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
        }
      });
    });

    // 2. Custom block rules (IDs starting at 20000)
    custom.forEach((pattern, index) => {
      // Clean up pattern for URL filter if needed
      newRules.push({
        id: 20000 + index,
        priority: 50,
        action: { type: "block" },
        condition: {
          urlFilter: pattern,
          resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
        }
      });
    });
  }

  // Update dynamic rules: remove all old ones and add the new set
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules: newRules
  });
}

// Helper: Update Badge text for tab
async function updateBadge(tabId, count) {
  const data = await chrome.storage.local.get('adBlockEnabled');
  const enabled = data.adBlockEnabled !== false;

  if (enabled && count > 0) {
    chrome.action.setBadgeText({ text: count.toString(), tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4A4A', tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
}

// Helper: Reset stats for a single tab
async function resetTabStats(tabId) {
  const data = await chrome.storage.local.get('tabStats');
  let tabStats = data.tabStats || {};
  tabStats[tabId] = 0;
  await chrome.storage.local.set({ tabStats });
  chrome.action.setBadgeText({ text: '', tabId: tabId });
}

// Helper: Clean up stats for a closed tab
async function cleanTabStats(tabId) {
  const data = await chrome.storage.local.get('tabStats');
  let tabStats = data.tabStats || {};
  delete tabStats[tabId];
  await chrome.storage.local.set({ tabStats });
}

// Helper: Increment blocker statistics
async function incrementBlockCount(tabId) {
  const data = await chrome.storage.local.get(['totalBlocked', 'tabStats']);
  let totalBlocked = data.totalBlocked || 0;
  let tabStats = data.tabStats || {};

  totalBlocked += 1;
  tabStats[tabId] = (tabStats[tabId] || 0) + 1;

  await chrome.storage.local.set({ totalBlocked, tabStats });
  await updateBadge(tabId, tabStats[tabId]);
}

// Listen for rule matches in developer mode
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info.request.tabId;
    if (tabId && tabId !== -1) {
      incrementBlockCount(tabId);
    }
  });
}

// Tab navigation handler
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    resetTabStats(tabId);
  }
});

// Tab close handler
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanTabStats(tabId);
});

// Watch for settings changes to trigger rule syncing
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local') {
    if (changes.adBlockEnabled) {
      await syncStaticRulesets();
      await syncDynamicRules();
      
      const enabled = changes.adBlockEnabled.newValue !== false;
      if (!enabled) {
        // Clear badges on all tabs when disabled
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          chrome.action.setBadgeText({ text: '', tabId: tab.id });
        }
      }
    } else if (changes.whitelistedDomains || changes.customRules) {
      await syncDynamicRules();
    }
  }
});
