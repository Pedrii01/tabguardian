const state = {
  tabs: [],
  filter: "all",
  systemCapacityMb: 4096,
};

async function getTabHeapMb(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => (performance && performance.memory ? performance.memory.usedJSHeapSize : null),
    });
    const bytes = results?.[0]?.result;
    return typeof bytes === "number" ? Math.round(bytes / (1024 * 1024)) : null;
  } catch (err) {
    console.debug("[TabGuardian] no memory data for tab", tabId, err.message);
    return null;
  }
}

async function getRealTabs() {
  const tabs = await chrome.tabs.query({});

  return Promise.all(
    tabs.map(async (tab) => {
      let memoryMb = 0;
      let hasMemoryData = false;

      if (!tab.discarded) {
        const mb = await getTabHeapMb(tab.id);
        if (mb !== null) {
          memoryMb = mb;
          hasMemoryData = true;
        }
      }

      let domain = "";
      try {
        domain = new URL(tab.url).hostname || tab.url;
      } catch {
        domain = tab.url || "";
      }

      return {
        id: tab.id,
        title: tab.title || domain || "Untitled tab",
        domain,
        memoryMb,
        hasMemoryData,
        suspended: !!tab.discarded,
        active: !!tab.active,
        pinned: !!tab.pinned,
        audible: !!tab.audible,
        favIconUrl: tab.favIconUrl,
      };
    })
  );
}

async function loadAndRender() {
  try {
    const [tabs, sysMem] = await Promise.all([
      getRealTabs(),
      chrome.system.memory.getInfo(),
    ]);
    state.tabs = tabs;
    state.systemCapacityMb = sysMem.capacity / (1024 * 1024);
  } catch (err) {
    console.error("[TabGuardian] failed to load tab data", err);
  }
  render();
}

const HEAVY_THRESHOLD_MB = 150;
const WARN_THRESHOLD_MB = 80;
const DANGER_THRESHOLD_MB = 200;
const BAR_MAX_MB = 250;

function memLevel(mb) {
  if (mb >= DANGER_THRESHOLD_MB) return "danger";
  if (mb >= WARN_THRESHOLD_MB) return "warn";
  return "normal";
}

function faviconLetter(domain) {
  const clean = (domain || "?").replace("www.", "");
  return clean[0] ? clean[0].toUpperCase() : "?";
}

function renderRing(tabs) {
  const totalMb = tabs.reduce((sum, t) => sum + t.memoryMb, 0);
  const totalGb = (totalMb / 1024).toFixed(1);
  const circumference = 176;

  const pct = Math.min(totalMb / state.systemCapacityMb, 1);
  const offset = circumference - pct * circumference;

  const ring = document.getElementById("ringProgress");
  ring.style.strokeDashoffset = offset;
  if (pct > 0.75) ring.style.stroke = "var(--danger)";
  else if (pct > 0.45) ring.style.stroke = "var(--warn)";
  else ring.style.stroke = "var(--accent)";

  document.getElementById("ringValue").textContent = totalGb;
}

function renderSubtitle(tabs) {
  const active = tabs.filter((t) => !t.suspended).length;
  const suspended = tabs.length - active;
  document.getElementById("subtitle").textContent =
    `${tabs.length} tabs · ${active} active · ${suspended} suspended`;
}

function getSuspendableTabs() {
  return state.tabs.filter((t) => !t.active && !t.pinned && !t.audible && !t.suspended);
}

function renderRow(tab) {
  const row = document.createElement("div");
  row.className = "tab-row" + (tab.suspended ? " is-suspended" : "");
  row.dataset.id = tab.id;

  const level = memLevel(tab.memoryMb);
  const pct = tab.hasMemoryData ? Math.min((tab.memoryMb / BAR_MAX_MB) * 100, 100) : 0;
  const memLabel = tab.hasMemoryData ? `${tab.memoryMb} MB` : "—";

  const faviconHtml = tab.favIconUrl
    ? `<img src="${tab.favIconUrl}" alt="" />`
    : faviconLetter(tab.domain);

  row.innerHTML = `
    <div class="favicon">${faviconHtml}</div>
    <div class="tab-info">
      <div class="tab-title">${escapeHtml(tab.title)}</div>
      <div class="tab-meta">
        <span class="tab-domain">${escapeHtml(tab.domain)}</span>
        <div class="mem-bar-track">
          <div class="mem-bar-fill ${level !== "normal" ? "level-" + level : ""}" style="width:${pct}%"></div>
        </div>
        <span class="mem-value">${memLabel}</span>
      </div>
    </div>
    ${
      tab.active
        ? `<span class="active-badge">Active</span>`
        : `<button class="toggle ${tab.suspended ? "is-on" : ""}" title="${
            tab.suspended ? "Resume tab" : "Suspend tab"
          }"></button>`
    }
  `;

  const img = row.querySelector(".favicon img");
  if (img) {
    img.addEventListener("error", () => {
      row.querySelector(".favicon").textContent = faviconLetter(tab.domain);
    });
  }

  const toggleBtn = row.querySelector(".toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => toggleSuspend(tab.id));
  }

  return row;
}

function render() {
  const list = document.getElementById("tabList");
  const emptyState = document.getElementById("emptyState");
  list.innerHTML = "";

  const filtered = state.tabs.filter((t) => {
    if (state.filter === "heavy") return t.memoryMb >= HEAVY_THRESHOLD_MB;
    if (state.filter === "suspended") return t.suspended;
    return true;
  });

  if (filtered.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    filtered.forEach((tab) => list.appendChild(renderRow(tab)));
  }

  renderRing(state.tabs);
  renderSubtitle(state.tabs);

  const suspendAllBtn = document.getElementById("suspendAllBtn");
  const eligible = getSuspendableTabs();
  suspendAllBtn.disabled = eligible.length === 0;
  suspendAllBtn.textContent = eligible.length ? `Suspend inactive (${eligible.length})` : "Suspend inactive";
}

async function toggleSuspend(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.active) return;

  try {
    if (tab.suspended) {
      await chrome.tabs.reload(id);
    } else {
      await chrome.tabs.discard(id);
    }
  } catch (err) {
    console.warn("[TabGuardian] toggle failed for tab", id, err.message);
  }

  setTimeout(loadAndRender, 300);
}

async function suspendAllInactive() {
  const btn = document.getElementById("suspendAllBtn");
  const eligible = getSuspendableTabs();
  if (eligible.length === 0) return;

  btn.disabled = true;
  await Promise.allSettled(eligible.map((t) => chrome.tabs.discard(t.id)));
  setTimeout(loadAndRender, 300);
}

function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.filter === filter);
  });
  render();
}

async function refresh() {
  const btn = document.getElementById("refreshBtn");
  btn.classList.add("is-spinning");
  await loadAndRender();
  btn.classList.remove("is-spinning");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function wireLiveUpdates() {
  const debouncedRefresh = debounce(loadAndRender, 400);

  chrome.tabs.onUpdated.addListener(debouncedRefresh);

  
  chrome.tabs.onRemoved.addListener(debouncedRefresh);
  chrome.tabs.onActivated.addListener(debouncedRefresh);

  window.addEventListener("unload", () => {
    chrome.tabs.onUpdated.removeListener(debouncedRefresh);
    chrome.tabs.onRemoved.removeListener(debouncedRefresh);
    chrome.tabs.onActivated.removeListener(debouncedRefresh);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const { autoSuspendMinutes = 30 } = await chrome.storage.local.get("autoSuspendMinutes");
  document.getElementById("autoSuspendSelect").value = String(autoSuspendMinutes);

  await loadAndRender();
  wireLiveUpdates();

  document.getElementById("refreshBtn").addEventListener("click", refresh);
  document.getElementById("suspendAllBtn").addEventListener("click", suspendAllInactive);

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => setFilter(chip.dataset.filter));
  });

  document.getElementById("autoSuspendSelect").addEventListener("change", async (e) => {
    await chrome.storage.local.set({ autoSuspendMinutes: Number(e.target.value) });
  });
});
