const ALARM_NAME = "tabguardian-sweep";
const SWEEP_INTERVAL_MINUTES = 1;

async function getSettings() {
  const { autoSuspendMinutes = 30, tabActivity = {} } = await chrome.storage.local.get([
    "autoSuspendMinutes",
    "tabActivity",
  ]);
  return { autoSuspendMinutes, tabActivity };
}

async function touchTab(tabId) {
  if (tabId === undefined || tabId === chrome.tabs.TAB_ID_NONE) return;
  const { tabActivity } = await getSettings();
  tabActivity[tabId] = Date.now();
  await chrome.storage.local.set({ tabActivity });
}

async function forgetTab(tabId) {
  const { tabActivity } = await getSettings();
  delete tabActivity[tabId];
  await chrome.storage.local.set({ tabActivity });
}


//pending 
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("autoSuspendMinutes");
  if (existing.autoSuspendMinutes === undefined) {
    await chrome.storage.local.set({ autoSuspendMinutes: 30, tabActivity: {} });
  }
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_INTERVAL_MINUTES });
});

chrome.tabs.onActivated.addListener(({ tabId }) => touchTab(tabId));

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") touchTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const { autoSuspendMinutes, tabActivity } = await getSettings();
  if (!autoSuspendMinutes) return;

  const thresholdMs = autoSuspendMinutes * 60 * 1000;
  const now = Date.now();
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.audible || tab.discarded) continue;

    const lastActive = tabActivity[tab.id] ?? now;
    if (now - lastActive >= thresholdMs) {
      try {
        await chrome.tabs.discard(tab.id);
      } catch (err) {
        console.warn("[TabGuardian] could not discard tab", tab.id, err.message);
      }
    }
  }
});
