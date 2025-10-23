// Brave history → YouTube recent endpoint
// Auto-detect Brave profile and support more YouTube URL shapes.
const fs = require("fs");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const PORT = 5607;

// Allow hub to fetch from http://localhost:5500
app.use((_, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  next();
});

// WebKit epoch → JS Date
function webkitTimeToMs(webkitMicroseconds) {
  const EPOCH_DIFF_MS = 11644473600000;
  return Math.floor(webkitMicroseconds / 1000) - EPOCH_DIFF_MS;
}

// Auto-detect Brave profile History file (or use BRAVE_HISTORY_PATH)
const HISTORY_DIR = `${process.env.HOME}/Library/Application Support/BraveSoftware/Brave-Browser`;
function findHistoryFile() {
  if (process.env.BRAVE_HISTORY_PATH && fs.existsSync(process.env.BRAVE_HISTORY_PATH)) {
    return process.env.BRAVE_HISTORY_PATH;
  }
  const candidates = [];
  try {
    const dirs = fs.readdirSync(HISTORY_DIR).filter(d => d === "Default" || d.startsWith("Profile"));
    for (const d of dirs) {
      const p = path.join(HISTORY_DIR, d, "History");
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        candidates.push({ path: p, mtime: stat.mtimeMs });
      }
    }
  } catch (_) {}
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

const HISTORY_PATH = findHistoryFile();
const RECENCY_DAYS = Number(process.env.RECENCY_DAYS || 14);
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

function safeCopy(src) {
  const tmpDir = path.join(__dirname, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const dest = path.join(tmpDir, "BraveHistory.sqlite");
  fs.copyFileSync(src, dest);
  return dest;
}

function queryRows(sql, params = []) {
  const source = HISTORY_PATH;
  if (!source) throw new Error("Brave history file not found");
  const copyPath = safeCopy(source);
  const db = new Database(copyPath, { readonly: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

function getRecentYouTube(limit = 50) {
  const rows = queryRows(`
    SELECT urls.url AS url, urls.title AS title, visits.visit_time AS visit_time
    FROM urls
    JOIN visits ON urls.id = visits.url
    WHERE urls.url LIKE '%youtube.com/watch%'
       OR urls.url LIKE '%youtube.com/shorts/%'
       OR urls.url LIKE '%youtu.be/%'
    ORDER BY visits.visit_time DESC
    LIMIT ?
  `, [limit]);

  const items = [];
  const seen = new Set();
  const now = Date.now();

  for (const r of rows) {
    const lastVisited = webkitTimeToMs(r.visit_time);
    if (now - lastVisited > RECENCY_MS) continue;

    try {
      const u = new URL(r.url);
      let id = null;
      if (u.hostname.includes("youtu.be")) {
        const seg = u.pathname.split("/").filter(Boolean)[0];
        id = seg || null;
      } else if (u.pathname.startsWith("/shorts/")) {
        const seg = u.pathname.split("/").filter(Boolean)[1];
        id = seg || null;
      } else {
        id = u.searchParams.get("v");
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);

      items.push({
        service: "youtube",
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: r.title || "YouTube Video",
        thumb: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
        lastVisited
      });
    } catch {}
  }
  return items;
}

function getRecentForDomains(limit = 80) {
  const domains = [
    { service: "netflix", match: "netflix.com", prefer: [/\/watch\/\d+/, /\/title\/\d+/] },
    { service: "hulu", match: "hulu.com", prefer: [/\/watch\/[A-Za-z0-9]+/] },
    { service: "disney", match: "disneyplus.com", prefer: [/\/video\/[A-Za-z0-9]+/] },
    { service: "prime", match: "primevideo.com", prefer: [/\/detail\/[^\/]+/] },
    { service: "max", match: "max.com", prefer: [/\/video\/[A-Za-z0-9-]+/] },
    { service: "peacock", match: "peacocktv.com", prefer: [/\/watch\/[^\/]+/, /\/movies\/[^\/]+\/[A-Za-z0-9-]+/] },
    { service: "paramount", match: "paramountplus.com", prefer: [/\/shows\/.+\/video\/[A-Za-z0-9]+/, /\/movies\/[^\/]+\/[A-Za-z0-9]+/] }
  ];

  const rows = queryRows(`
    SELECT urls.url AS url, urls.title AS title, visits.visit_time AS visit_time
    FROM urls
    JOIN visits ON urls.id = visits.url
    WHERE ${domains.map(d => `urls.url LIKE '%${d.match}%'`).join(" OR ")}
    ORDER BY visits.visit_time DESC
    LIMIT ?
  `, [limit]);

  const now = Date.now();
  const seenUrl = new Set();
  const items = [];

  for (const r of rows) {
    const lastVisited = webkitTimeToMs(r.visit_time);
    if (now - lastVisited > RECENCY_MS) continue;

    try {
      const u = new URL(r.url);
      const host = u.hostname;
      const domainConf = domains.find(d => host.includes(d.match));
      if (!domainConf) continue;

      // Prefer “watch”/“detail”/“video” pages
      const path = u.pathname + (u.search || "");
      const isPreferred = domainConf.prefer?.some(rx => rx.test(path)) ?? true;
      if (!isPreferred) continue;

      // De-dupe exact URL
      const canonical = u.toString();
      if (seenUrl.has(canonical)) continue;
      seenUrl.add(canonical);

      items.push({
        service: domainConf.service,
        url: canonical,
        title: r.title || domainConf.service,
        thumb: null, // client will fallback to local service icon
        lastVisited
      });
    } catch {}
  }
  return items;
}

app.get("/history/youtube", (_req, res) => {
  try {
    if (!HISTORY_PATH || !fs.existsSync(HISTORY_PATH)) {
      return res.status(404).json({ error: "Brave history not found", path: HISTORY_PATH || "(auto-detect failed)" });
    }
    const items = getRecentYouTube(50);
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/history/all", (_req, res) => {
  try {
    if (!HISTORY_PATH || !fs.existsSync(HISTORY_PATH)) {
      return res.status(404).json({ error: "Brave history not found", path: HISTORY_PATH || "(auto-detect failed)" });
    }
    const yt = getRecentYouTube(60);
    const others = getRecentForDomains(120);
    const items = [...yt, ...others].sort((a, b) => b.lastVisited - a.lastVisited);
    res.json({ items, recencyDays: RECENCY_DAYS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Brave history server listening at http://localhost:${PORT}/history/all`);
  console.log(`History file: ${HISTORY_PATH}`);
  console.log(`Recency filter: last ${RECENCY_DAYS} days`);
});