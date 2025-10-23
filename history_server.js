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

    const args = [
      "-a", "Brave Browser",
      "-n",
      "--args",
      "--new-window",
      `--profile-directory=${profileId}`,
      targetUrl
    ];
    const proc = spawn("open", args, { detached: true, stdio: "ignore" });
    proc.unref();

    res.json({ launched: true, profileId, url: targetUrl });
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

app.listen(PORT, () => {
  console.log(`Brave history server listening at http://localhost:${PORT}/history/all`);
  console.log(`Recency filter: last ${RECENCY_DAYS} days`);
});