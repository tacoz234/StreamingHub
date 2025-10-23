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

    // macOS launch: force a new window and profile selection
    const args = [
      "-a", "Brave Browser",
      "-n",              // try to launch a new instance
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

app.listen(PORT, () => {
  console.log(`Brave history server listening at http://localhost:${PORT}/history/all`);
  console.log(`Recency filter: last ${RECENCY_DAYS} days`);
});