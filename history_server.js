const express = require("express");
const fs = require("fs");

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
app.use((_, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
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

app.listen(PORT, () => {
  console.log(`Brave history server listening at http://localhost:${PORT}/history/all`);
  console.log(`Recency filter: last ${RECENCY_DAYS} days`);
});