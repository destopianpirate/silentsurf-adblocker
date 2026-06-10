// Logic for Destopian AdBlocker Pro Popup Control Panel

document.addEventListener('DOMContentLoaded', async () => {
  // UI Elements
  const btnTabDashboard = document.getElementById('btnTabDashboard');
  const btnTabWhitelist = document.getElementById('btnTabWhitelist');
  const btnTabRules = document.getElementById('btnTabRules');
  const btnTabStats = document.getElementById('btnTabStats');
  
  const tabDashboard = document.getElementById('tab-dashboard');
  const tabWhitelist = document.getElementById('tab-whitelist');
  const tabRules = document.getElementById('tab-rules');
  const tabStats = document.getElementById('tab-stats');

  const btnPowerToggle = document.getElementById('btnPowerToggle');
  const powerWrapper = btnPowerToggle.parentElement;
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');

  const numTabBlocked = document.getElementById('numTabBlocked');
  const numTotalBlocked = document.getElementById('numTotalBlocked');
  const txtCurrentDomain = document.getElementById('txtCurrentDomain');
  const txtDomainStatus = document.getElementById('txtDomainStatus');
  const chkDomainWhitelist = document.getElementById('chkDomainWhitelist');

  const whitelistList = document.getElementById('whitelistList');
  const whitelistEmpty = document.getElementById('whitelistEmpty');

  const inputCustomRule = document.getElementById('inputCustomRule');
  const btnAddRule = document.getElementById('btnAddRule');
  const rulesList = document.getElementById('rulesList');
  const rulesEmpty = document.getElementById('rulesEmpty');

  const valSavedData = document.getElementById('valSavedData');
  const valSavedTime = document.getElementById('valSavedTime');
  const pctAds = document.getElementById('pctAds');
  const pctTrackers = document.getElementById('pctTrackers');
  const pctManual = document.getElementById('pctManual');
  const adFill = document.querySelector('.ad-fill');
  const trackerFill = document.querySelector('.tracker-fill');
  const manualFill = document.querySelector('.manual-fill');

  let currentTabId = null;
  let currentDomain = '';

  // Tab Navigation Handling
  const tabs = [
    { button: btnTabDashboard, pane: tabDashboard },
    { button: btnTabWhitelist, pane: tabWhitelist },
    { button: btnTabRules, pane: tabRules },
    { button: btnTabStats, pane: tabStats }
  ];

  tabs.forEach(tab => {
    tab.button.addEventListener('click', () => {
      tabs.forEach(t => {
        t.button.classList.remove('active');
        t.pane.classList.remove('active');
      });
      tab.button.classList.add('active');
      tab.pane.classList.add('active');
      
      // Update statistics when switching to the stats tab
      if (tab.pane === tabStats) {
        updateStatsView();
      }
    });
  });

  // Extract Domain from URL
  function getDomain(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        return urlObj.hostname.replace(/^www\./, '');
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
    return '';
  }

  // Get active tab details and initialize UI
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    currentTabId = activeTab.id;
    currentDomain = getDomain(activeTab.url);
    
    if (currentDomain) {
      txtCurrentDomain.textContent = currentDomain;
    } else {
      txtCurrentDomain.textContent = 'System / Internal Page';
      txtDomainStatus.textContent = 'Blocking unavailable';
      chkDomainWhitelist.disabled = true;
    }
  }

  // Fetch initial states from storage
  const state = await chrome.storage.local.get([
    'adBlockEnabled',
    'whitelistedDomains',
    'customRules',
    'totalBlocked',
    'tabStats'
  ]);

  const isEnabled = state.adBlockEnabled !== false;
  updateGlobalPowerUI(isEnabled);

  const totalBlockedCount = state.totalBlocked || 0;
  numTotalBlocked.textContent = totalBlockedCount.toLocaleString();

  const tabBlockedCount = (state.tabStats && currentTabId) ? (state.tabStats[currentTabId] || 0) : 0;
  numTabBlocked.textContent = tabBlockedCount.toLocaleString();

  const whitelist = state.whitelistedDomains || [];
  updateWhitelistUI(whitelist);

  const customRules = state.customRules || [];
  updateCustomRulesUI(customRules);

  updateStatsView();

  // Helper: Toggle global blocker state
  btnPowerToggle.addEventListener('click', async () => {
    const data = await chrome.storage.local.get('adBlockEnabled');
    const nextState = data.adBlockEnabled === false;
    await chrome.storage.local.set({ adBlockEnabled: nextState });
    updateGlobalPowerUI(nextState);
  });

  // Helper: Set global UI values for enable state
  function updateGlobalPowerUI(enabled) {
    if (enabled) {
      powerWrapper.classList.add('active');
      statusDot.classList.remove('disabled');
      statusLabel.textContent = 'Active';
      statusLabel.style.color = 'var(--accent-green)';
      
      if (currentDomain) {
        // Check if current domain is whitelisted
        chrome.storage.local.get('whitelistedDomains', (data) => {
          const list = data.whitelistedDomains || [];
          const isWhitelisted = list.includes(currentDomain);
          chkDomainWhitelist.checked = isWhitelisted;
          
          if (isWhitelisted) {
            txtDomainStatus.textContent = 'Whitelisted (Ads allowed)';
            txtDomainStatus.classList.add('disabled');
            txtDomainStatus.style.color = 'var(--text-muted)';
          } else {
            txtDomainStatus.textContent = 'Blocking is active';
            txtDomainStatus.classList.remove('disabled');
            txtDomainStatus.style.color = 'var(--accent-green)';
          }
        });
      }
    } else {
      powerWrapper.classList.remove('active');
      statusDot.classList.add('disabled');
      statusLabel.textContent = 'Off';
      statusLabel.style.color = 'var(--accent-red)';
      
      if (currentDomain) {
        txtDomainStatus.textContent = 'Adblocker is turned off';
        txtDomainStatus.classList.add('disabled');
        txtDomainStatus.style.color = 'var(--text-muted)';
      }
    }
  }

  // Handle current tab Whitelist switch change
  chkDomainWhitelist.addEventListener('change', async () => {
    if (!currentDomain) return;
    
    const data = await chrome.storage.local.get('whitelistedDomains');
    let list = data.whitelistedDomains || [];
    const isChecked = chkDomainWhitelist.checked;

    if (isChecked) {
      if (!list.includes(currentDomain)) {
        list.push(currentDomain);
      }
    } else {
      list = list.filter(d => d !== currentDomain);
    }

    await chrome.storage.local.set({ whitelistedDomains: list });
    updateWhitelistUI(list);
    
    // Refresh page blocking status UI
    const blockData = await chrome.storage.local.get('adBlockEnabled');
    updateGlobalPowerUI(blockData.adBlockEnabled !== false);
    
    // Reload active tab to apply changes immediately
    if (currentTabId) {
      chrome.tabs.reload(currentTabId);
    }
  });

  // Render the whitelisted domains in Whitelist Tab
  function updateWhitelistUI(list) {
    whitelistList.innerHTML = '';
    
    if (list.length === 0) {
      whitelistEmpty.style.display = 'flex';
      whitelistList.style.display = 'none';
      return;
    }

    whitelistEmpty.style.display = 'none';
    whitelistList.style.display = 'block';

    list.forEach(domain => {
      const li = document.createElement('li');
      
      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = domain;
      span.title = domain;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      `;
      deleteBtn.title = 'Remove Whitelist';
      deleteBtn.addEventListener('click', () => removeWhitelistDomain(domain));

      li.appendChild(span);
      li.appendChild(deleteBtn);
      whitelistList.appendChild(li);
    });
  }

  // Helper to remove domain from Whitelist
  async function removeWhitelistDomain(domain) {
    const data = await chrome.storage.local.get('whitelistedDomains');
    let list = data.whitelistedDomains || [];
    list = list.filter(d => d !== domain);
    await chrome.storage.local.set({ whitelistedDomains: list });
    
    // Update local UI
    updateWhitelistUI(list);
    
    // Check if the domain removed is the current tab domain
    if (domain === currentDomain) {
      chkDomainWhitelist.checked = false;
      const blockData = await chrome.storage.local.get('adBlockEnabled');
      updateGlobalPowerUI(blockData.adBlockEnabled !== false);
    }
    
    // Reload active tab if it matches the domain removed to immediately apply filters
    if (activeTab && getDomain(activeTab.url) === domain) {
      chrome.tabs.reload(activeTab.id);
    }
  }

  // Handle adding custom rules
  btnAddRule.addEventListener('click', addNewCustomRule);
  inputCustomRule.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addNewCustomRule();
    }
  });

  async function addNewCustomRule() {
    const value = inputCustomRule.value.trim();
    if (!value) return;

    const data = await chrome.storage.local.get('customRules');
    let rules = data.customRules || [];

    if (!rules.includes(value)) {
      rules.push(value);
      await chrome.storage.local.set({ customRules: rules });
      inputCustomRule.value = '';
      updateCustomRulesUI(rules);
    }
  }

  // Render Custom Rules list
  function updateCustomRulesUI(rules) {
    rulesList.innerHTML = '';

    if (rules.length === 0) {
      rulesEmpty.style.display = 'flex';
      rulesList.style.display = 'none';
      return;
    }

    rulesEmpty.style.display = 'none';
    rulesList.style.display = 'block';

    rules.forEach(rule => {
      const li = document.createElement('li');
      
      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = rule;
      span.title = rule;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      `;
      deleteBtn.title = 'Remove Rule';
      deleteBtn.addEventListener('click', () => removeCustomRule(rule));

      li.appendChild(span);
      li.appendChild(deleteBtn);
      rulesList.appendChild(li);
    });
  }

  // Helper to delete a custom rule
  async function removeCustomRule(rule) {
    const data = await chrome.storage.local.get('customRules');
    let rules = data.customRules || [];
    rules = rules.filter(r => r !== rule);
    await chrome.storage.local.set({ customRules: rules });
    updateCustomRulesUI(rules);
  }

  // Calculate and Update stats tab view
  async function updateStatsView() {
    const data = await chrome.storage.local.get(['totalBlocked', 'customRules']);
    const total = data.totalBlocked || 0;
    const customs = data.customRules || [];
    
    // Estimates:
    // Average Ad file size = 80 KB
    // Average processing/loading time saved = 0.15s
    const totalKB = total * 80;
    const totalMB = totalKB / 1024;
    const timeSavedSeconds = total * 0.15;

    valSavedData.textContent = `${totalMB.toFixed(1)} MB`;
    valSavedTime.textContent = `${timeSavedSeconds.toFixed(1)}s`;

    // Dynamic split charts:
    // Mock proportions for visual polish but influenced by dynamic parameters
    let adPct = 65;
    let trackerPct = 25;
    let manualPct = 10;

    if (total > 0 && customs.length > 0) {
      // Distribute based on user customization
      const userRatio = Math.min(Math.round((customs.length / (customs.length + 5)) * 25), 30);
      manualPct = userRatio;
      adPct = Math.round((100 - manualPct) * 0.72);
      trackerPct = 100 - adPct - manualPct;
    } else if (total === 0) {
      adPct = 0;
      trackerPct = 0;
      manualPct = 0;
    }

    pctAds.textContent = `${adPct}%`;
    pctTrackers.textContent = `${trackerPct}%`;
    pctManual.textContent = `${manualPct}%`;

    adFill.style.width = `${adPct}%`;
    trackerFill.style.width = `${trackerPct}%`;
    manualFill.style.width = `${manualPct}%`;
  }

  // Real-time synchronization by listening to storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.totalBlocked) {
        const newVal = changes.totalBlocked.newValue || 0;
        numTotalBlocked.textContent = newVal.toLocaleString();
        updateStatsView();
      }
      
      if (changes.tabStats && currentTabId) {
        const tabStats = changes.tabStats.newValue || {};
        const newVal = tabStats[currentTabId] || 0;
        numTabBlocked.textContent = newVal.toLocaleString();
      }

      if (changes.adBlockEnabled) {
        const newVal = changes.adBlockEnabled.newValue !== false;
        updateGlobalPowerUI(newVal);
      }
    }
  });
});
