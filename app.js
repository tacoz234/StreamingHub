// Update a few entries to show how to add icons.
// Use your own logo files under `icons/` or remote URLs.
const services = [
  { id: "youtube", url: "https://www.youtube.com/", tint: ["#d00000", "#640000"], icon: "icons/youtube.jpg" },
  { id: "netflix", url: "https://www.netflix.com/", tint: ["#e50914", "#3a0004"], icon: "icons/netflix.svg" },
  { id: "hulu", url: "https://www.hulu.com/", tint: ["#00d36e", "#003b2c"], icon: "icons/hulu.jpg" },
  { id: "disney", url: "https://www.disneyplus.com/", tint: ["#0a84ff", "#001a3b"], icon: "icons/disney.png" },
  { id: "prime", url: "https://www.amazon.com/gp/video/storefront?redirectToCMP=1", tint: ["#00a8e1", "#002b3d"], icon: "icons/prime.png" },
  { id: "max", url: "https://www.max.com/", tint: ["#745cf9", "#1a133c"], icon: "icons/hbomax.png" },
  { id: "appletv", url: "https://tv.apple.com/", tint: ["#7b7b7b", "#1f1f1f"], icon: "icons/apple_tv.png" },
  { id: "peacock", url: "https://www.peacocktv.com/", tint: ["#ffd70f", "#3a2f00"], icon: "icons/peacock.png" },
  { id: "paramount", url: "https://www.paramountplus.com/", tint: ["#00a3ff", "#003455"], icon: "icons/paramount.png" },
  { id: "applemusic", url: "https://music.apple.com/", tint: ["#fa2d48", "#6b1f22"], icon: "icons/apple_music.png" },
  { id: "youtubetv", url: "https://tv.youtube.com/", tint: ["#ff0000", "#330000"], icon: "icons/youtube_tv.png" }
];

const RECENT_KEY = "hub_recent_services";
const MAX_RECENT = 10;

function saveVisit(id) {
  const now = Date.now();
  let recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  // Keep unique by id and latest first
  recent = [{ id, ts: now }, ...recent.filter(r => r.id !== id)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function getRecent() {
  const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  const map = Object.fromEntries(services.map(s => [s.id, s]));
  // Only include those that still exist in services
  return recent.map(r => ({ ...map[r.id], lastVisited: r.ts })).filter(Boolean);
}

// Replace: function clearRecent() { ... }
function clearRecent() {
  localStorage.removeItem(RECENT_KEY);          // app visits
  localStorage.removeItem(RECENT_VIDEOS_KEY);   // saved YouTube videos
  renderContinue();
}

function openService(service, evt) {
  // Persist visit before navigation
  saveVisit(service.id);
  const openInNewTab = evt?.metaKey || evt?.ctrlKey || evt?.button === 1;
  if (openInNewTab) {
    window.open(service.url, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = service.url;
  }
}

// In: function createCard(service, { badgeText } = {}) { ... }
// createCard(service, { badgeText, resumeUrl } = {})
function createCard(service, { badgeText, resumeUrl } = {}) {
    const label = service.name || SERVICE_LABELS[service.id] || (service.id || "Open");

    // Anchor only (remove previous button-based declaration)
    const card = document.createElement("a");
    card.className = "card";
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", label);
    card.href = resumeUrl && service.id === "youtube" ? resumeUrl : service.url;

    card.onclick = async (e) => {
        // YouTube inline player (Shift-click)
        if (service.id === "youtube" && e.shiftKey) {
            e.preventDefault();
            promptYouTubeURL();
            return;
        }

        // Persist visit and allow default navigation (same tab)
        saveVisit(service.id);

        // Do NOT prevent default; let the anchor decide:
        // - Normal click → same tab
        // - Cmd/Ctrl/middle-click → new tab (native browser behavior)
    };

    const [t0, t1] = service.tint;
    const tint = document.createElement("div");
    tint.className = "card__tint";
    tint.style.background = `linear-gradient(135deg, ${t0}, ${t1})`;

    const bg = document.createElement("div");
    bg.className = "card__bg";

    const overlay = document.createElement("div");
    overlay.className = "card__overlay";

    let logo = null;
    if (service.icon) {
        card.classList.add("card--has-icon");
        logo = document.createElement("img");
        logo.className = "card__logo";
        logo.src = service.icon;
        logo.alt = `${label} icon`;
        logo.loading = "lazy";
    }

    // Removed inner text content (name/sub) so the card itself has no caption
    card.append(bg, tint);
    if (logo) card.append(logo);
    card.append(overlay);

    if (badgeText) {
        const badge = document.createElement("div");
        badge.className = "card__badge";
        badge.textContent = badgeText;
        card.appendChild(badge);
    }

    const wrap = document.createElement("div");
    wrap.className = "card-wrap";
    wrap.setAttribute("role", "listitem");

    const caption = document.createElement("div");
    caption.className = "card-caption";
    caption.textContent = label;
    caption.style.pointerEvents = "none";

    wrap.append(card, caption);
    return wrap;
  return card;
}

function renderGrid() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  services.forEach(svc => grid.appendChild(createCard(svc)));
}

// Add YouTube-specific continue watching support
const RECENT_VIDEOS_KEY = "hub_recent_videos";

// Replace: function renderContinue() { ... }
function renderContinue() {
  const section = document.getElementById("continue-section");
  const row = document.getElementById("continue-row");
  row.innerHTML = "";

  const savedVideos = getSavedVideos(); // YouTube via hub modal, with progress
  const historyItems = braveHistory;    // Aggregated Brave (YT + other services)
  const recentApps = getRecent();

  if (savedVideos.length === 0 && historyItems.length === 0 && recentApps.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const maxTotal = 12;
  let count = 0;

  // 1) Saved videos with progress (YouTube only)
  for (const v of savedVideos) {
    if (count >= maxTotal) break;
    row.appendChild(createVideoCard({ ...v, service: "youtube" }));
    count++;
  }

  // 2) Brave history videos (YouTube + other services), avoid duplicates
  const savedIds = new Set(savedVideos.map(v => v.id));
  for (const item of historyItems) {
    if (count >= maxTotal) break;
    if (item.service === "youtube" && savedIds.has(item.id)) continue;
    row.appendChild(createVideoCard(item));
    count++;
  }

  // 3) App-level “Continue” tiles
  const ytResume = getYouTubeResumeUrl();
  for (const svc of recentApps) {
    if (count >= maxTotal) break;
    const options = { badgeText: "Continue" };
    if (svc.id === "youtube" && ytResume) {
      options.resumeUrl = ytResume;
    }
    row.appendChild(createCard(svc, options));
    count++;
  }
}

// ---- YouTube helpers ----
function parseYouTubeId(input) {
  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1);
    if (url.searchParams.has("v")) return url.searchParams.get("v");
    const match = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  } catch (_) {
    // Not a URL; maybe a raw ID
    const idMatch = input.match(/^[a-zA-Z0-9_-]{11}$/);
    if (idMatch) return input;
  }
  return null;
}

async function fetchYouTubeMeta(videoId) {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const res = await fetch(oembedUrl);
    if (!res.ok) throw new Error("oEmbed failed");
    const data = await res.json();
    // oEmbed thumbnail is 480x360; prefer HQ if available
    const fallbackThumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    return { title: data.title, thumb: data.thumbnail_url || fallbackThumb };
  } catch {
    return {
      title: "YouTube Video",
      thumb: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };
  }
}

function getSavedVideos() {
  const arr = JSON.parse(localStorage.getItem(RECENT_VIDEOS_KEY) || "[]");
  // sort newest first
  return arr.sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveVideoProgress(entry) {
  const current = getSavedVideos();
  const filtered = current.filter(v => v.id !== entry.id);
  const updated = [
    { ...entry, updatedAt: Date.now() },
    ...filtered
  ].slice(0, 20);
  localStorage.setItem(RECENT_VIDEOS_KEY, JSON.stringify(updated));
}

// In: function createVideoCard(v) { ... }
// createVideoCard(v)
function createVideoCard(v) {
    // Build target URL:
    const resumeSeconds = Math.floor(v.progress || 0);
    const isYouTube = v.service === "youtube" || (!!v.id && !v.url);
    const targetUrl = v.url
        || (isYouTube
            ? `https://www.youtube.com/watch?v=${v.id}${resumeSeconds ? `&t=${resumeSeconds}s` : ""}`
            : "#");

    // Anchor only (remove previous button-based declaration)
    const card = document.createElement("a");
    card.className = "video-card";
    card.setAttribute("role", "listitem");
    card.href = targetUrl;

    card.onclick = (e) => {
        if (isYouTube && e.shiftKey && v.id) {
            e.preventDefault();
            launchYouTubePlayer(v.id, resumeSeconds);
        }
    };

    const img = document.createElement("img");
    img.className = "video-card__thumb";
    img.src = v.thumb || SERVICE_ICONS[v.service] || SERVICE_ICONS.youtube;
    img.alt = v.title || "Continue";
    img.loading = "lazy";

    const overlay = document.createElement("div");
    overlay.className = "video-card__overlay";

    const content = document.createElement("div");
    content.className = "video-card__content";

    const title = document.createElement("div");
    title.className = "video-card__title";
    title.textContent = SERVICE_LABELS[v.service] || (v.service || "Continue");

    const progress = document.createElement("div");
    progress.className = "video-card__progress";
    const bar = document.createElement("span");
    const pct = v.duration ? Math.min(100, Math.round((v.progress / v.duration) * 100)) : 0;
    bar.style.width = `${pct}%`;
    progress.appendChild(bar);

    content.append(title);
    card.append(img, overlay, content, progress);
    return card;

  // Remove marquee behavior; short labels don’t need it.
  return card;
}

// ---- Modal + YouTube Player ----
let ytReady = false;
let ytReadyPromise = null;
let player = null;
let progressTimer = null;

function ensureYouTubeAPI() {
  if (ytReadyPromise) return ytReadyPromise;
  ytReadyPromise = new Promise(resolve => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      ytReady = true;
      resolve();
    };
  });
  return ytReadyPromise;
}

async function launchYouTubePlayer(videoId, startSeconds = 0) {
  const meta = await fetchYouTubeMeta(videoId);
  document.getElementById("modal-title").textContent = meta.title;
  showModal();

  await ensureYouTubeAPI();

  if (player) {
    player.loadVideoById({ videoId, startSeconds });
  } else {
    player = new YT.Player("yt-container", {
      playerVars: { autoplay: 1, rel: 0, start: startSeconds },
      videoId,
      events: {
        onReady: () => player.playVideo(),
        onStateChange: () => {
          // Start/stop progress tracking based on player state
          const state = player.getPlayerState();
          if (state === YT.PlayerState.PLAYING) {
            if (progressTimer) clearInterval(progressTimer);
            progressTimer = setInterval(() => {
              const progress = player.getCurrentTime();
              const duration = player.getDuration() || 0;
              saveVideoProgress({
                id: videoId,
                title: meta.title,
                thumb: meta.thumb,
                progress,
                duration
              });
              renderContinue();
            }, 1500);
          } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED) {
            if (progressTimer) clearInterval(progressTimer);
            const progress = player.getCurrentTime();
            const duration = player.getDuration() || 0;
            saveVideoProgress({
              id: videoId,
              title: meta.title,
              thumb: meta.thumb,
              progress,
              duration
            });
            renderContinue();
          }
        }
      }
    });
  }
}

function showModal() {
  const modal = document.getElementById("player-modal");
  modal.hidden = false;
}

function hideModal() {
  const modal = document.getElementById("player-modal");
  modal.hidden = true;
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  // Keep player instance to reuse; you can destroy if desired:
  // if (player) { player.destroy(); player = null; }
}

// Prompt to play a YouTube URL inside the hub
async function promptYouTubeURL() {
  const input = window.prompt("Paste a YouTube URL or ID:");
  if (!input) return;
  const id = parseYouTubeId(input.trim());
  if (!id) {
    alert("Could not parse YouTube video ID.");
    return;
  }
  // Resume from saved progress if available
  const saved = getSavedVideos().find(v => v.id === id);
  const start = saved ? Math.floor(saved.progress || 0) : 0;
  launchYouTubePlayer(id, start);
}

// Wire up modal close + play button
// Ensure history is loaded on boot before first render
function boot() {
  renderGrid();
  loadBraveHistory().finally(() => renderContinue());

  // Removed: clear-continue and play-youtube button listeners
  // document.getElementById("clear-continue").addEventListener("click", clearRecent);
  // const btn = document.getElementById("play-youtube-btn");
  // if (btn) btn.addEventListener("click", promptYouTubeURL);

  const close = document.getElementById("modal-close");
  if (close) close.addEventListener("click", hideModal);

  const backdrop = document.querySelector("#player-modal .modal__backdrop");
  if (backdrop) backdrop.addEventListener("click", hideModal);

  // Account modal wiring
  const acctBtn = document.getElementById("btn-account");
  if (acctBtn) acctBtn.addEventListener("click", showAccountModal);

  const acctClose = document.getElementById("account-close");
  if (acctClose) acctClose.addEventListener("click", hideAccountModal);

  const acctBackdrop = document.querySelector("#account-modal .modal__backdrop");
  if (acctBackdrop) acctBackdrop.addEventListener("click", hideAccountModal);

  // Enable TV-style navigation and set initial focus to top-left grid tile
  enableKeyboardNav();
  focusInitialElement();
}

  const settings = document.getElementById("btn-settings");
  if (settings) settings.addEventListener("click", () => {
    // Placeholder: route to settings or open modal
    alert("Settings coming soon");
  });


document.addEventListener("DOMContentLoaded", boot);

// Top-level additions
// Use aggregated Brave history
// Top-level state and helpers
const BRAVE_HISTORY_API = "http://localhost:5607/history/all";
let braveHistory = [];

// Local fallback icons for services (used when no thumbnail available)
// Add service display labels near SERVICE_ICONS
const SERVICE_ICONS = {
  youtube: "icons/youtube.jpg",
  netflix: "icons/netflix.svg",
  hulu: "icons/hulu.jpg",
  disney: "icons/disney.png",
  prime: "icons/prime.png",
  max: "icons/hbomax.png",
  peacock: "icons/peacock.png",
  paramount: "icons/paramount.png",
  appletv: "icons/apple_tv.png",
  applemusic: "icons/apple_music.png",
  youtubetv: "icons/youtube_tv.png",
  plex: null
};

const SERVICE_LABELS = {
  youtube: "YouTube",
  netflix: "Netflix",
  hulu: "Hulu",
  disney: "Disney+",
  prime: "Prime Video",
  max: "Max",
  peacock: "Peacock",
  paramount: "Paramount+",
  appletv: "Apple TV",
  applemusic: "Apple Music",
  youtubetv: "YouTube TV",
  plex: "Plex"
};

// NEW: read profile from URL (fallback to localStorage)
const PROFILE_KEY = "hub_profile_id";
function getProfileFromURL() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("profile");
  } catch { return null; }
}
let activeProfileId = getProfileFromURL() || localStorage.getItem(PROFILE_KEY) || null;

// Update history loader to respect profile
async function loadBraveHistory() {
  try {
    const url = `${BRAVE_HISTORY_API}${activeProfileId ? `?profile=${encodeURIComponent(activeProfileId)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`History API ${res.status}`);
    const data = await res.json();
    braveHistory = Array.isArray(data.items) ? data.items : [];
    braveHistory = braveHistory.map(it => ({
      ...it,
      thumb: it.thumb || SERVICE_ICONS[it.service] || null
    }));
  } catch (e) {
    braveHistory = [];
    console.warn("Brave history fetch failed:", e.message);
  }
}

// Add helper to pick the best YouTube resume target (saved progress > Brave history)
function getYouTubeResumeUrl() {
  const saved = getSavedVideos();
  if (saved.length > 0) {
    const v = saved[0];
    const t = Math.floor(v.progress || 0);
    return `https://www.youtube.com/watch?v=${v.id}${t ? `&t=${t}s` : ""}`;
  }
  // Brave history (no progress)
  if (typeof braveHistory !== "undefined" && braveHistory.length > 0) {
    const v = braveHistory[0];
    return `https://www.youtube.com/watch?v=${v.id}`;
  }
  return null;
}

// Account modal logic
async function fetchProfiles() {
  try {
    const res = await fetch("http://localhost:5607/profiles");
    if (!res.ok) throw new Error(`Profiles ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.profiles) ? data.profiles : [];
  } catch (e) {
    console.warn("Fetch profiles failed:", e.message);
    return [];
  }
}

function hideAccountModal() {
  const modal = document.getElementById("account-modal");
  if (modal) modal.hidden = true;

  // Return nav to header and focus the Account button
  const acctBtn = document.getElementById("btn-account");
  if (acctBtn) {
    navState.section = "header";
    focusElement(acctBtn);
  } else {
    // Fallback to grid top-left if account button not found
    focusInitialElement();
  }
}

async function showAccountModal() {
  const modal = document.getElementById("account-modal");
  const list = document.getElementById("profiles-list");
  if (!modal || !list) return;

  // Unhide and switch nav section to account
  modal.hidden = false;
  navState.prevSection = navState.section;
  navState.section = "account";
  navState.prevEl = document.activeElement;

  const profiles = await fetchProfiles();
  list.innerHTML = "";

  if (!profiles.length) {
    const msg = document.createElement("div");
    msg.style.color = "var(--muted)";
    msg.textContent = "No Brave profiles detected.";
    list.appendChild(msg);
  } else {
    for (const p of profiles) {
      const btn = document.createElement("button");
      btn.className = `profile-btn${activeProfileId === p.id ? " active" : ""}`;
      btn.textContent = p.label || p.id;
      btn.addEventListener("click", async () => {
        const prevId = activeProfileId; // capture the old profile
        activeProfileId = p.id;
        localStorage.setItem(PROFILE_KEY, activeProfileId);

        // NEW: generate a session token to protect the new tab
        const sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);

        const targetUrl = `${window.location.origin}${window.location.pathname}?profile=${encodeURIComponent(activeProfileId)}&sid=${encodeURIComponent(sid)}`;

        let launched = false;
        try {
          const resp = await fetch("http://localhost:5607/launch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profileId: activeProfileId, url: targetUrl })
          });
          launched = resp.ok;
        } catch (e) {
          console.warn("Launch in profile failed", e);
        }

        // Close modal and restore nav to header
        hideAccountModal();

        // NEW: ask server to close previous hub tabs (by sid)
        try {
          await fetch("http://localhost:5607/close-hub", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, host: window.location.host })
          });
        } catch (e) {
          console.warn("close-hub failed", e);
        }

        // If server didn't launch, fallback: navigate in this tab
        if (!launched) {
          window.location.href = targetUrl;
        }
      });
      list.appendChild(btn);
    }
  }

  // Focus the active profile or first item for keyboard navigation
  focusFirstAccountItem();
}

// NEW: helper to open a URL in the selected Brave profile via the server
async function launchInSelectedProfile(targetUrl) {
  const sid = (window.crypto && typeof window.crypto.randomUUID === "function")
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const urlWithSid = `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}sid=${encodeURIComponent(sid)}`;

  console.log("[tiles] launchInSelectedProfile", {
    targetUrl,
    urlWithSid,
    activeProfileId
  });

  // Change to '/open' so tiles reuse existing window (no new-window flags)
  return fetch("http://localhost:5607/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId: activeProfileId, url: urlWithSid, sessionId: sid })
  }).then(res => {
    console.log("[tiles] /open response", res.status);
    if (!res.ok) throw new Error(`open failed: ${res.status}`);
  }).catch((err) => {
    console.error("[tiles] /open failed, falling back to in-tab nav", err);
    // Fallback: navigate in this tab
    window.location.href = targetUrl;
  });
}

// Top-level keyboard navigation helpers (TV-style)
let navState = {
  section: "grid", // 'grid' | 'continue' | 'header' | 'account'
  prevSection: null,
  prevEl: null
};

function enableKeyboardNav() {
  document.addEventListener("keydown", onNavKeyDown, { capture: true });
}

function onNavKeyDown(e) {
  const key = e.key;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(key)) return;

  const active = document.activeElement;
  const section = navState.section;

  if (key === "Enter") {
    e.preventDefault();
    if (active && typeof active.click === "function") active.click();
    return;
  }

  if (section === "grid") {
    const rows = getGridRows();
    if (!rows.length) return;

    const pos = findGridPosition(active, rows);
    // If nothing focused yet, start top-left
    const rowIdx = pos ? pos.row : 0;
    const colIdx = pos ? pos.col : 0;

    if (key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      const row = rows[rowIdx];
      const nextCol = clampIndex(key === "ArrowLeft" ? colIdx - 1 : colIdx + 1, row.length);
      const next = row[nextCol];
      if (next) focusElement(next);
      return;
    }

    if (key === "ArrowUp" || key === "ArrowDown") {
      e.preventDefault();
      const nextRowIdx = key === "ArrowUp" ? rowIdx - 1 : rowIdx + 1;

      // Top row up → Continue, bottom row down → stay
      if (nextRowIdx < 0) {
        const contItems = getSectionItems("continue");
        if (contItems.length) {
          navState.section = "continue";
          const targetIdx = alignByX(rows[rowIdx][colIdx], contItems);
          focusElement(contItems[targetIdx]);
        } else {
          // If no Continue, jump to Header
          const headerItems = getSectionItems("header");
          if (headerItems.length) {
            navState.section = "header";
            const targetIdx = alignByX(rows[rowIdx][colIdx], headerItems);
            focusElement(headerItems[targetIdx]);
          }
        }
        return;
      }
      if (nextRowIdx >= rows.length) {
        // Bottom row; do not wrap
        return;
      }

      const currEl = rows[rowIdx][colIdx];
      const targetRow = rows[nextRowIdx];
      const targetIdx = alignByX(currEl, targetRow);
      const next = targetRow[targetIdx];
      if (next) focusElement(next);
      return;
    }

    return;
  }

  if (section === "continue") {
    const items = getSectionItems("continue");
    if (!items.length) return;

    const idx = indexOfElement(items, active) ?? 0;

    if (key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      const nextIdx = clampIndex(key === "ArrowLeft" ? idx - 1 : idx + 1, items.length);
      focusElement(items[nextIdx]);
      return;
    }

    if (key === "ArrowUp") {
      e.preventDefault();
      const headerItems = getSectionItems("header");
      if (headerItems.length) {
        navState.section = "header";
        const targetIdx = alignByX(items[idx], headerItems);
        focusElement(headerItems[targetIdx]);
      }
      return;
    }

    if (key === "ArrowDown") {
      e.preventDefault();
      const rows = getGridRows();
      if (rows.length) {
        navState.section = "grid";
        const row0 = rows[0];
        const targetIdx = alignByX(items[idx], row0);
        focusElement(row0[targetIdx]);
      }
      return;
    }
    return;
  }

  if (section === "header") {
    const items = getSectionItems("header");
    if (!items.length) return;

    const idx = indexOfElement(items, active) ?? 0;

    if (key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      const nextIdx = clampIndex(key === "ArrowLeft" ? idx - 1 : idx + 1, items.length);
      focusElement(items[nextIdx]);
      return;
    }

    if (key === "ArrowDown") {
      e.preventDefault();
      const contItems = getSectionItems("continue");
      if (contItems.length) {
        navState.section = "continue";
        const targetIdx = alignByX(items[idx], contItems);
        focusElement(contItems[targetIdx]);
      } else {
        const rows = getGridRows();
        if (rows.length) {
          navState.section = "grid";
          const row0 = rows[0];
          const targetIdx = alignByX(items[idx], row0);
          focusElement(row0[targetIdx]);
        }
      }
      return;
    }

    // ArrowUp from header: stay (no wrap)
    if (key === "ArrowUp") {
      e.preventDefault();
      return;
    }
  }

  // Trap focus and navigate inside Account modal
  if (section === "account") {
    const items = getAccountItems();
    if (!items.length) return;

    const idx = indexOfElement(items, active) ?? 0;

    if (key === "ArrowLeft" || key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = clampIndex(idx - 1, items.length);
      focusElement(items[prevIdx]);
      return;
    }
    if (key === "ArrowRight" || key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = clampIndex(idx + 1, items.length);
      focusElement(items[nextIdx]);
      return;
    }

    return;
  }
}

function focusInitialElement() {
  const rows = getGridRows();
  if (rows.length && rows[0].length) {
    navState.section = "grid";
    focusElement(rows[0][0]); // top-left
  }
}

function getSectionItems(section) {
  if (section === "header") {
    return [document.getElementById("btn-account"), document.getElementById("btn-settings")]
      .filter(Boolean).filter(isVisible);
  }
  if (section === "continue") {
    const row = document.getElementById("continue-row");
    if (!row) return [];
    return Array.from(row.querySelectorAll('a.card, a[href], button, [tabindex]:not([tabindex="-1"])'))
      .filter(isVisible);
  }
  return []; // grid handled via getGridRows()
}

// NEW: focusable items inside Account modal (includes Close + profiles)
function getAccountItems() {
  const modal = document.getElementById("account-modal");
  if (!modal || modal.hidden) return [];
  const content = modal.querySelector(".modal__content");
  if (!content) return [];
  return Array.from(content.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'))
    .filter(isVisible);
}

// NEW: focus active profile button or first item
function focusFirstAccountItem() {
  const items = getAccountItems();
  if (!items.length) return;

  const activeBtn = items.find(el => el.classList && el.classList.contains("active"));
  if (activeBtn) {
    focusElement(activeBtn);
    return;
  }
  focusElement(items[0]);
}

function getGridRows() {
  const grid = document.getElementById("grid");
  if (!grid) return [];
  const cards = Array.from(grid.querySelectorAll("a.card")).filter(isVisible);
  if (!cards.length) return [];

  // Group by Y (row) using top coordinate
  const rows = [];
  const threshold = 20; // px tolerance for row grouping
  const sorted = cards.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  for (const el of sorted) {
    const top = el.getBoundingClientRect().top;
    let row = rows.find(r => Math.abs(r._top - top) <= threshold);
    if (!row) {
      row = [];
      row._top = top;
      rows.push(row);
    }
    row.push(el);
  }

  // Sort each row by X (left to right)
  for (const r of rows) {
    r.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }
  return rows;
}

function findGridPosition(active, rows) {
  if (!active) return null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const j = row.indexOf(active);
    if (j >= 0) return { row: i, col: j };
  }
  return null;
}

function indexOfElement(list, el) {
  const i = el ? list.indexOf(el) : -1;
  return i >= 0 ? i : null;
}

function clampIndex(i, len) {
  if (i < 0) return 0;
  if (i >= len) return len - 1;
  return i;
}

function alignByX(fromEl, candidates) {
  if (!fromEl) return 0;
  try {
    const rc = fromEl.getBoundingClientRect();
    const cx = rc.left + rc.width / 2;
    let best = 0, bestDist = Infinity;
    candidates.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const d = Math.abs(x - cx);
      if (d < bestDist) { bestDist = d; best = idx; }
    });
    return best;
  } catch {
    return 0;
  }
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

function focusElement(el) {
  document.querySelectorAll(".kbd-focus").forEach(n => n.classList.remove("kbd-focus"));
  el.classList.add("kbd-focus");
  el.focus({ preventScroll: false });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function findNextByDirection(current, list, key) {
  const c = current.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;

    const dx = ex - cx;
    const dy = ey - cy;

    if (key === "ArrowRight" && dx <= 0) continue;
    if (key === "ArrowLeft" && dx >= 0) continue;
    if (key === "ArrowDown" && dy <= 0) continue;
    if (key === "ArrowUp" && dy >= 0) continue;

    const primary = (key === "ArrowLeft" || key === "ArrowRight") ? Math.abs(dx) : Math.abs(dy);
    const secondary = (key === "ArrowLeft" || key === "ArrowRight") ? Math.abs(dy) : Math.abs(dx);

    const score = primary * 2 + secondary; // prioritize straight moves, penalize diagonal
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}