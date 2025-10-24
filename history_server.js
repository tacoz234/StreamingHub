const express = require("express");
const fs = require("fs");
const { spawn } = require("child_process");

// Polyfill fetch for Node < 18
if (typeof fetch === "undefined") {
  global.fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

// Compose services/utilities from the new module structure
const { HISTORY_PATH, RECENCY_DAYS, listProfiles, setActiveHistoryPath } = require("./src/utils/db");
const { getRecentYouTube } = require("./src/services/youtube");
const { getRecentForDomains } = require("./src/services/domains");
const { normalizeItems } = require("./src/services/canonical");
const { enrichMeta } = require("./src/services/meta");
const { dedupeSeries } = require("./src/services/grouping");

const app = express();
const PORT = 5607;

// Allow hub to fetch data cross-origin
app.use(express.json());
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// NEW: list available Brave profiles
app.get("/profiles", (_req, res) => {
  try {
    const profiles = listProfiles();
    res.json({ profiles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/history/youtube", (req, res) => {
  try {
    const chosen = req.query.profile;
    if (chosen) {
      const match = listProfiles().find(p => p.id === chosen);
      if (match) setActiveHistoryPath(match.path);
    }

    if (!HISTORY_PATH && !chosen) {
      return res.status(404).json({
        error: "Brave history not found",
        path: "(auto-detect failed)"
      });
    }

    const items = getRecentYouTube(50);
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    setActiveHistoryPath(null);
  }
});

app.get("/history/all", async (req, res) => {
  try {
    const chosen = req.query.profile;
    if (chosen) {
      const match = listProfiles().find(p => p.id === chosen);
      if (match) setActiveHistoryPath(match.path);
    }

    if (!HISTORY_PATH && !chosen) {
      return res.status(404).json({
        error: "Brave history not found",
        path: "(auto-detect failed)"
      });
    }

    const yt = getRecentYouTube(60);
    const others = getRecentForDomains(120);
    let items = [...yt, ...others].sort((a, b) => b.lastVisited - a.lastVisited);

    items = normalizeItems(items);
    await enrichMeta(items, 120);
    items = dedupeSeries(items);

    res.json({ items, recencyDays: RECENCY_DAYS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    setActiveHistoryPath(null);
  }
});

// NEW: launch Brave in a selected profile and open the hub URL (macOS)
app.post("/launch", (req, res) => {
  try {
    const profileId = String(req.body?.profileId || req.query?.profile || "");
    const targetUrl =
      String(req.body?.url || req.query?.url) ||
      `http://127.0.0.1:8080/?profile=${encodeURIComponent(profileId || "Default")}`;

    const match = listProfiles().find(p => p.id === profileId);
    if (!match) {
      return res.status(400).json({ error: "Unknown profileId", profileId });
    }

    // Prefer spawning the Brave binary so --profile-directory is honored
    const braveBin = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
    const binArgs = [
      "--new-window",
      `--profile-directory=${profileId}`,
      targetUrl
    ];
    let launched = false;
    try {
      console.log("[server:/launch] spawn brave binary", braveBin, binArgs.join(" "));
      const proc = spawn(braveBin, binArgs, { detached: true, stdio: "ignore" });
      proc.unref();
      launched = true;
    } catch (e) {
      console.error("[server:/launch] brave binary failed, fallback to open -a", e);
    }

    if (!launched) {
      const args = [
        "-a", "Brave Browser",
        targetUrl, // URL before --args
        "--args",
        "--new-window",
        `--profile-directory=${profileId}`
      ];
      console.log("[server:/launch] spawn open", args.join(" "));
      const proc = spawn("open", args, { detached: true, stdio: "ignore" });
      proc.unref();
    }

    // After launch, enforce fullscreen without minimizing or double-toggling
    setTimeout(() => {
      const script = `
        tell application "Brave Browser" to activate
    
        -- Wait for at least one window
        repeat with i from 1 to 30
          try
            if (count of windows) > 0 then exit repeat
          end try
          delay 0.2
        end repeat
    
        -- Unminimize and raise the front window
        try
          repeat with w in windows
            try
              set value of attribute "AXMinimized" of w to false
            end try
          end repeat
        end try
        try
          perform action "AXRaise" of window 1
        end try
        delay 0.1
    
        -- Check current fullscreen state
        set isFull to false
        try
          set isFull to (value of attribute "AXFullScreen" of window 1)
        end try
    
        if isFull is not true then
          -- Preferred: click menu 'View → Enter Full Screen' (idempotent)
          set usedMenu to false
          try
            set usedMenu to true
            click menu item "Enter Full Screen" of menu 1 of menu bar item "View" of menu bar 1
            delay 0.3
          on error
            set usedMenu to false
          end try
    
          -- Re-check after menu click
          try
            set isFull to (value of attribute "AXFullScreen" of window 1)
          end try
          if isFull is not true and usedMenu is false then
            -- Fallback: Accessibility attribute
            try
              set value of attribute "AXFullScreen" of window 1 to true
              delay 0.2
            end try
            -- Re-check
            try
              set isFull to (value of attribute "AXFullScreen" of window 1)
            end try
            if isFull is not true then
              -- Fallback: Shift+Command+F (requested), then Control+Command+F
              try
                keystroke "f" using {shift down, command down}
                delay 0.3
              end try
              try
                set isFull to (value of attribute "AXFullScreen" of window 1)
              end try
              if isFull is not true then
                try
                  keystroke "f" using {control down, command down}
                end try
              end if
            end if
          end if
    
          -- Ensure window stays visible and raised
          try
            set value of attribute "AXMinimized" of window 1 to false
            perform action "AXRaise" of window 1
          end try
        end tell
      end tell
    `;
    const sproc = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
    sproc.unref();
  }, 1400);

    res.json({ launched: true, profileId, url: targetUrl, fullscreenRequested: true });
  } catch (e) {
    console.error("Launch failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// NEW: close hub tabs in Brave (macOS AppleScript)
// NEW: close hub tabs from the previous profile id, exclude new profile id
app.post("/close-hub", (req, res) => {
  try {
    const host = String(req.body?.host || "127.0.0.1:8080");
    const alt = "localhost:8080";
    const sessionId = String(req.body?.sessionId || "");
    if (!sessionId) {
      return res.json({ closed: false, reason: "no sessionId provided" });
    }
    const esc = s => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const script = `
      set hostStr to "${esc(host)}"
      set altHostStr to "${alt}"
      set sidStr to "${esc(sessionId)}"

      tell application "Brave Browser"
        -- Wait up to ~4s for the new tab with sid to appear
        set foundNew to false
        repeat with i from 1 to 20
          set foundNew to false
          repeat with w in windows
            repeat with t in tabs of w
              set u to URL of t
              if ((u contains hostStr) or (u contains altHostStr)) and (u contains "sid=" & sidStr) then
                set foundNew to true
              end if
            end repeat
          end repeat
          if foundNew then exit repeat
          delay 0.2
        end repeat

        set toClose to {}
        repeat with w in windows
          repeat with t in tabs of w
            set u to URL of t
            set hostMatch to ((u contains hostStr) or (u contains altHostStr))
            set isNewTab to (u contains "sid=" & sidStr)
            if hostMatch and (not isNewTab) then
              set end of toClose to t
            end if
          end repeat
        end repeat

        repeat with t in toClose
          try
            close t
          end try
        end repeat
      end tell
    `;
    const proc = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
    proc.unref();

    res.json({ closed: true, host, sessionId });
  } catch (e) {
    console.error("close-hub failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// NEW: open a URL in the selected Brave profile (reuse existing window/tab)
app.post("/open", (req, res) => {
  try {
    const profileId = String(req.body?.profileId || req.query?.profile || "");
    const url = String(
      req.body?.url ||
      req.query?.url ||
      "http://127.0.0.1:8080/"
    );
    const sessionId = String(req.body?.sessionId || "");

    console.log("[server:/open] req", { profileId, url, sessionId });

    const { listProfiles } = require("./src/utils/db");
    const match = listProfiles().find(p => p.id === profileId);
    if (!match) {
      console.error("[server:/open] Unknown profileId", profileId);
      return res.status(400).json({ error: "Unknown profileId", profileId });
    }
    console.log("[server:/open] profile resolved", match.id);

    // Preferred: open via `open` with URL BEFORE --args
    let opened = false;
    try {
      const args = [
        "-a", "Brave Browser",
        url,                // URL must come before --args
        "--args",
        `--profile-directory=${profileId}`
      ];
      console.log("[server:/open] spawn open", args.join(" "));
      const openProc = spawn("open", args);
      openProc.on("close", (code) => console.log("[server:/open] open exit", code));
      opened = true;
    } catch (e) {
      console.error("[server:/open] open failed, will try binary", e);
    }

    // Fallback: spawn Brave binary directly
    if (!opened) {
      try {
        const braveBin = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
        const binArgs = [`--profile-directory=${profileId}`, url];
        console.log("[server:/open] spawn brave binary", braveBin, binArgs.join(" "));
        const binProc = spawn(braveBin, binArgs, { detached: true, stdio: "ignore" });
        binProc.unref();
        opened = true;
      } catch (e) {
        console.error("[server:/open] brave binary failed", e);
      }
    }

    // Build focus AppleScript (by sid or hostname)
    const esc = s => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const sidStr = esc(sessionId);
    let host = "";
    try { host = new URL(url).hostname; } catch {}
    const hostStr = esc(host);

    const script = `
      set sidProvided to ${sidStr ? "true" : "false"}
      set sidStr to "${sidStr}"
      set hostStr to "${hostStr}"

      tell application "Brave Browser"
        set foundTab to missing value
        set foundByHost to missing value

        -- Wait up to ~5s for the tab to appear
        repeat with i from 1 to 25
          repeat with w in windows
            repeat with t in tabs of w
              set u to URL of t
              if sidProvided and (u contains ("sid=" & sidStr)) then
                set foundTab to {w, t}
                exit repeat
              end if
              if (hostStr is not "") and (u contains hostStr) then
                set foundByHost to {w, t}
              end if
            end repeat
            if foundTab is not missing value then exit repeat
          end repeat

          if foundTab is not missing value then exit repeat
          delay 0.2
        end repeat

        if foundTab is missing value and foundByHost is not missing value then
          set foundTab to foundByHost
        end if

        if foundTab is not missing value then
          set theWindow to item 1 of foundTab
          set theTab to item 2 of foundTab
          set index of theWindow to 1
          set active tab of theWindow to theTab
          activate
        else
          activate
        end if
      end tell
    `;

    // Schedule focus after a short delay to give Brave time to create the tab
    setTimeout(() => {
      console.log("[server:/open] focusing tab (sid/host)", { sessionId, host });
      const focusProc = spawn("osascript", ["-e", script]);
      focusProc.on("error", (e) => console.error("[server:/open] focus script error", e));
      focusProc.stdout?.on("data", d => console.log("[server:/open] focus stdout:", String(d).trim()));
      focusProc.stderr?.on("data", d => console.error("[server:/open] focus stderr:", String(d).trim()));
      focusProc.on("close", (code) => console.log("[server:/open] focus script exit", code));
    }, 250);

    res.json({ opened: opened, profileId, url, focusScheduled: true });
  } catch (e) {
    console.error("Open failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// Helper: open hub in fullscreen on server start
const HUB_URL = process.env.HUB_URL || "http://127.0.0.1:8080/";
const HUB_PROFILE_ID = process.env.HUB_PROFILE_ID || "Default";

async function waitForHub(maxMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(HUB_URL, { method: "HEAD" });
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function openHubOnStart() {
  try {
    const hubReady = await waitForHub();
    if (!hubReady) {
      console.warn("[server:start] hub not reachable, opening anyway");
    }

    const profiles = listProfiles();
    const match = profiles.find(p => p.id === HUB_PROFILE_ID) || profiles[0];
    const profileId = match?.id || HUB_PROFILE_ID;
    const profileArg = match ? `--profile-directory=${profileId}` : null;

    const targetUrl = `${HUB_URL}?profile=${encodeURIComponent(profileId || "Default")}`;

    // Preferred: spawn Brave binary directly with fullscreen flags
    const braveBin = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
    const useKiosk = process.env.HUB_KIOSK === "1";
    let launched = false;
    try {
      const binArgs = [ "--new-window", useKiosk ? "--kiosk" : "--start-fullscreen" ];
      if (profileArg) binArgs.push(profileArg);
      binArgs.push(targetUrl);
      console.log("[server:start] spawn brave binary", braveBin, binArgs.join(" "));
      const binProc = spawn(braveBin, binArgs, { detached: true, stdio: "ignore" });
      binProc.unref();
      launched = true;
    } catch (e) {
      console.error("[server:start] binary launch failed, will try open -a", e);
    }

    // Fallback: use `open -a` with URL before --args
    if (!launched) {
      const args = [
        "-a", "Brave Browser",
        targetUrl,
        "--args",
        "--new-window",
        useKiosk ? "--kiosk" : "--start-fullscreen"
      ];
      if (profileArg) args.push(profileArg);

      console.log("[server:start] opening hub via open -a", { profileId, targetUrl, args });
      const proc = spawn("open", args, { detached: true, stdio: "ignore" });
      proc.unref();
    }

    // Force macOS fullscreen using requested keystroke first, with reliable fallbacks
    setTimeout(() => {
      const script = `
        -- Bring Brave frontmost
        tell application "Brave Browser" to activate
    
        -- 1) Requested: Shift+Command+F
        tell application "System Events"
          try
            keystroke "f" using {shift down, command down}
          end try
        end tell
    
        -- 2) Try Accessibility fullscreen attribute (AXFullScreen)
        tell application "System Events"
          tell application process "Brave Browser"
            set frontmost to true
    
            -- Wait for window to exist
            repeat with i from 1 to 25
              try
                if (count of windows) > 0 then exit repeat
              end try
              delay 0.2
            end repeat
    
            try
              set value of attribute "AXFullScreen" of window 1 to true
            end try
          end tell
        end tell
    
        -- 3) Fallback: Control+Command+F (macOS standard fullscreen)
        tell application "System Events"
          try
            keystroke "f" using {control down, command down}
          end try
        end tell
      `;
      console.log("[server:start] enforcing fullscreen via AX/menu/keystrokes");
      const sproc = spawn("osascript", ["-e", script]);
      sproc.on("error", (e) => console.error("[server:start] fullscreen script error", e));
      sproc.stderr?.on("data", d => console.error("[server:start] fullscreen stderr:", String(d).trim()));
      sproc.on("close", (code) => console.log("[server:start] fullscreen script exit", code));
    }, 1000);
  } catch (e) {
    console.error("[server:start] openHubOnStart failed:", e);
  }
}

app.listen(PORT, () => {
  console.log(`Brave history server listening at http://localhost:${PORT}/history/all`);
  console.log(`Recency filter: last ${RECENCY_DAYS} days`);
  openHubOnStart();
});