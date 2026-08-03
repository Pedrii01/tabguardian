# TabGuardian

A Chrome extension that shows you how much memory your open tabs are actually using, and lets you suspend the ones you don't need — manually, in bulk, or automatically after a set idle time.

## Features

- Live per-tab JS heap usage, read straight from each page's own `performance.memory`
- One tab, one glance: memory bar color shifts from blue to amber to red as usage climbs
- A ring at the top showing total tab memory relative to your system's total RAM
- Suspend or resume any tab with a single toggle
- "Suspend inactive" bulk action for clearing out everything at once
- Auto-suspend: tabs idle past a threshold you set (15 min / 30 min / 1 hour) get suspended automatically in the background
- Filter by All / Heavy (150MB+) / Suspended

## Install

1. Download and unzip this folder
2. Go to `chrome://extensions`
3. Turn on Developer mode (top right)
4. Click "Load unpacked" and select the `tabguardian` folder

## Files

```
tabguardian/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── icons/
└── README.md
```

`popup.js` handles everything you see when you open the extension — reading tab memory, rendering the list, the ring, suspending/resuming. `background.js` runs independently of the popup, tracking when each tab was last active and sweeping for idle tabs to auto-suspend once a minute.

## How the memory numbers actually work (read this before demoing it)

There's no public, stable-channel Chrome API that hands extensions a clean "this tab uses X memory" number. `chrome.processes` looks like it would do exactly that, but it's restricted to Chrome's Dev channel — it silently does nothing on the stable Chrome almost everyone runs. That's a real limitation of the platform, not something fixable with different permissions.

The workaround here: `chrome.scripting.executeScript` injects a tiny function into each tab's own page context (`world: "MAIN"`) and reads `performance.memory.usedJSHeapSize` — the page's own JavaScript heap size. This works on stable Chrome, no special channel needed.

**Important honesty check:** this is JS heap size, not total process memory. It excludes DOM structures, the rendering/compositor layer, images, and GPU memory — all of which are often the *majority* of what a heavy tab actually costs you. So the numbers TabGuardian shows are a real, comparable signal for "which of my tabs is relatively heavier," but they systematically understate the tab's true footprint. Worth saying exactly this if it comes up in an interview — it shows you understand the limits of your own data source rather than presenting an approximation as a precise measurement.

## Why the permissions changed

Reading heap size on every open tab requires `host_permissions: ["<all_urls>"]` plus the `scripting` permission — a genuinely broad ask. Chrome will show users a "Read and change all your data on all websites" warning at install, and the Web Store review process scrutinizes this permission combination closely.

This is a real product trade-off, not a technical detail: broad host access buys back a working memory feature on stable Chrome, at the cost of a scarier permission prompt and a privacy policy requirement. Framing the tool honestly (a memory *helper*, not a *monitor* that phones anything home) matters here — nothing is transmitted anywhere, everything stays local, but the permission itself doesn't say that on its own.

## Concepts this project touches

- **Manifest V3 architecture** — service workers instead of persistent background pages, and what that means for state
- **Chrome's execution worlds** — the difference between a content script's isolated world and a page's own MAIN world, and why only the latter sees the page's real `performance.memory`
- **Platform API availability tiers** — stable vs. Dev/Canary channel APIs, and designing around what's actually usable in production rather than what merely appears in the docs
- **Async orchestration** — chaining `chrome.tabs.query` and per-tab `chrome.scripting.executeScript` calls with `Promise.all`, handling partial failures (chrome:// pages, the Web Store, PDF viewer) without breaking the whole render
- **Ephemeral service worker state** — MV3 service workers get killed and restarted constantly, so anything that needs to persist (like per-tab idle timestamps) has to live in `chrome.storage.local`, not a JS variable
- **Scheduled background work** — using `chrome.alarms` instead of `setInterval`, because `setInterval` doesn't survive a service worker restart and `chrome.alarms` does
- **Content Security Policy constraints** — MV3's default CSP blocks inline event handlers, which forces event binding through `addEventListener` even for dynamically generated rows
- **Permission trade-offs as a product decision** — least-privilege isn't free; broader access buys real functionality back, and that's a call worth being able to explain, not just implement

## What I learned building this

- That "the docs say this API exists" and "this API works for a normal Chrome user" are two different questions — `chrome.processes` cost me a full debugging session before I found it's Dev-channel-only
- Why MV3 forces you to treat the background script as stateless — an in-memory activity tracker in `background.js` silently lost data every time the service worker went idle and restarted, which is what pushed the design toward `chrome.storage.local`
- The difference between a content script's isolated JS world and the page's own world — and that you have to explicitly ask for `world: "MAIN"` to read something like `performance.memory`, otherwise you're reading your own script's tiny heap, not the page's
- That `chrome.tabs.discard()` frees memory but keeps the tab in the strip, and resuming it is just `chrome.tabs.reload()` — no special "wake up" API needed
- How real the gap is between "approximation that's honestly labeled" and "approximation dressed up as precision" — and that the second one is the kind of thing that falls apart under one good interview question

## Known limitations

- Memory shown is JS heap only, not full tab/process memory (see above)
- Requires broad host permissions (`<all_urls>`), which is a real permission cost worth being upfront about in any store listing
- Auto-suspend checks run once a minute, so idle detection isn't sub-minute precise
- Internal Chrome pages (`chrome://`, the Web Store, the PDF viewer) can't be scripted into — shown as `—` in the list
- `performance.memory` is a non-standard, Chromium-only API; it isn't part of any web spec and could change behavior in future Chrome versions

## Before publishing to the Chrome Web Store

- [ ] Write a privacy policy page stating clearly that nothing is transmitted anywhere — required for the `<all_urls>` host permission
- [ ] In the Web Store listing form, justify each permission: `tabs` (list tabs), `scripting` + `<all_urls>` (read JS heap per page), `system.memory` (scale the ring), `storage` (persist settings), `alarms` (auto-suspend schedule)
- [ ] Test with 15-20+ real tabs open, including a few `chrome://` and PDF tabs, to confirm the `—` fallback looks right
- [ ] Store listing assets: 128×128 icon (already have it), at least one 1280×800 screenshot, a 440×280 promo tile if you want featured placement
- [ ] Bump `version` in `manifest.json` for every re-submission
- [ ] Zip the folder *contents* (not the folder itself) so `manifest.json` sits at the zip root
