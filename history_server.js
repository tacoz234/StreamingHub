// Brave history → YouTube recent endpoint
// Auto-detect Brave profile and support more YouTube URL shapes.
// Add: HTML metadata enrichment for thumbnails/titles
const fs = require("fs");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");
const cheerio = require("cheerio");

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

// Prefer content pages per domain (tighten Peacock)
function getRecentForDomains(limit = 80) {
  const domains = [
    { service: "netflix",   match: "netflix.com",       prefer: [/\/watch\/\d+/, /\/title\/\d+/] },
    { service: "hulu",      match: "hulu.com",          prefer: [/\/watch\/[A-Za-z0-9]+/, /\/series\/[^\/]+/] },
    { service: "disney",    match: "disneyplus.com",    prefer: [/\/video\/[A-Za-z0-9]+/, /\/series\/[^\/]+/, /\/movie\/[^\/]+/] },
    { service: "prime",     match: "primevideo.com",    prefer: [/\/detail\/[^\/]+/] },
    { service: "max",       match: "max.com",           prefer: [/\/video\/[A-Za-z0-9-]+/, /\/series\/[^\/]+/] },
    // Peacock: prefer logic handled inline (flexible), no strict pattern here
    { service: "peacock",   match: "peacocktv.com" },
    { service: "paramount", match: "paramountplus.com", prefer: [/\/shows\/.+\/video\/[A-Za-z0-9]+/, /\/movies\/[^\/]+\/[A-Za-z0-9]+/, /\/shows\/[^\/]+/] }
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
  const seenCanonical = new Set();
  const items = [];

  for (const r of rows) {
    const lastVisited = webkitTimeToMs(r.visit_time);
    if (now - lastVisited > RECENCY_MS) continue;

    try {
      const u = new URL(r.url);
      const host = u.hostname;
      const domainConf = domains.find(d => host.includes(d.match));
      if (!domainConf) continue;

      // Exclude obvious non-content pages
      if (host.includes("peacocktv.com")) {
        const nonContent = new Set(["/", "/start", "/home", "/browse", "/channels", "/sports", "/kids", "/account"]);
        if (nonContent.has(u.pathname)) continue;

        // Flexible content detection for Peacock:
        // - any /watch path (with or without id/query)
        // - /shows/<slug> or /movies/<slug>
        // - presence of playbackId/assetId/id in query
        const peacockContent =
          u.pathname.startsWith("/watch") ||
          u.pathname.startsWith("/shows/") ||
          u.pathname.startsWith("/movies/") ||
          u.searchParams.has("playbackId") ||
          u.searchParams.has("assetId") ||
          u.searchParams.has("asset_id") ||
          u.searchParams.has("id");
        if (!peacockContent) continue;
      } else {
        // Non-Peacock: use domain-specific prefer rules (path+search)
        const pathWithSearch = u.pathname + (u.search || "");
        const isPreferred = domainConf.prefer?.some(rx => rx.test(pathWithSearch)) ?? true;
        if (!isPreferred) continue;
      }

      // Keep ORIGINAL URL for launching, compute canonical URL for dedupe/grouping
      const originalUrl = u.toString();
      const canonicalized = canonicalizeItem({
        service: domainConf.service,
        url: originalUrl,
        title: r.title || domainConf.service,
        thumb: null,
        lastVisited
      });
      if (!canonicalized) continue;

      const canonicalUrl = canonicalized.canonicalUrl || originalUrl;
      if (seenCanonical.has(canonicalUrl)) continue;
      seenCanonical.add(canonicalUrl);

      items.push(canonicalized);
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

// Normalize TV series titles by removing season/episode markers
function normalizeSeriesTitle(raw) {
  if (!raw) return null;
  let t = String(raw);

  // Remove patterns like "S1:E3", "S01E03", "S1xE3"
  t = t.replace(/\bS\d{1,2}\s*[:x]?\s*E\d{1,3}\b/gi, "");
  t = t.replace(/\bS\d{1,2}E\d{1,3}\b/gi, "");

  // Remove "Season 2", "Episode 5", "Ep. 5", "Chapter 3", "Part 2"
  t = t.replace(/\bSeason\s*\d+\b/gi, "");
  t = t.replace(/\bEpisode\s*\d+\b/gi, "");
  t = t.replace(/\bEp\.?\s*\d+\b/gi, "");
  t = t.replace(/\bChapter\s*\d+\b/gi, "");
  t = t.replace(/\bPart\s*\d+\b/gi, "");

  // Remove parenthetical episode markers e.g. "(S2:E3)", "(Episode 4)"
  t = t.replace(/\(\s*(S\d+\s*[:x]?\s*E\d+|Episode\s*\d+|Ep\.?\s*\d+)\s*\)/gi, "");

  // Drop service suffixes e.g. "The Office - Peacock"
  t = t.replace(/\s*[•\-–—|:]\s*Peacock\b/gi, "");

  // Drop common marketing noise (helps TMDb/TVMaze match)
  t = t.replace(/\b(Superfan Episodes|Extras|Bonus|Extended Cut|Director'?s Cut|Unrated|Extended)\b/gi, "");

  // Clean leftover separators
  t = t.replace(/\s*[•\-–—|:]\s*/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();

  return t.length ? t : null;
}

// Build a grouping key for series; prefer URL slugs/IDs when available
function urlSeriesKey(item) {
  try {
    const u = new URL(item.canonicalUrl || item.url);
    const p = u.pathname.toLowerCase();

    if (u.hostname.includes("peacocktv.com")) {
      // Group shows/movies by slug; watch pages fall back to normalized title
      const m1 = p.match(/\/movies\/([^\/]+)/);
      const m2 = p.match(/\/shows\/([^\/]+)/);
      if (m1) return `peacock:movies:${m1[1]}`;
      if (m2) return `peacock:shows:${m2[1]}`;
      return null;
    }
    if (u.hostname.includes("netflix.com")) {
      const m = p.match(/\/title\/(\d+)/);
      if (m) return `netflix:title:${m[1]}`;
    } else if (u.hostname.includes("primevideo.com")) {
      const m = p.match(/\/detail\/([^\/?]+)/);
      if (m) return `prime:detail:${m[1]}`;
    } else if (u.hostname.includes("peacocktv.com")) {
      const m1 = p.match(/\/movies\/([^\/]+)/);
      const m2 = p.match(/\/shows\/([^\/]+)/);
      const m3 = p.match(/\/watch\/asset\/([^\/]+)/);
      if (m1) return `peacock:movies:${m1[1]}`;
      if (m2) return `peacock:shows:${m2[1]}`;
      if (m3) return `peacock:watch:${m3[1]}`; // episode ID as grouping
    } else if (u.hostname.includes("paramountplus.com")) {
      const m = p.match(/\/shows\/([^\/]+)/);
      if (m) return `paramount:shows:${m[1]}`;
    } else if (u.hostname.includes("max.com")) {
      const m1 = p.match(/\/series\/([^\/]+)/);
      const m2 = p.match(/\/video\/([^\/]+)/);
      if (m1) return `max:series:${m1[1]}`;
      if (m2) return `max:video:${m2[1]}`;
    } else if (u.hostname.includes("disneyplus.com")) {
      const m1 = p.match(/\/series\/([^\/]+)/);
      const m2 = p.match(/\/movie\/([^\/]+)/);
      if (m1) return `disney:series:${m1[1]}`;
      if (m2) return `disney:movie:${m2[1]}`;
    } else if (u.hostname.includes("hulu.com")) {
      const m = p.match(/\/series\/([^\/]+)/);
      if (m) return `hulu:series:${m[1]}`;
    }
  } catch {
    // ignore
  }
  return null;
}

// Coarse fingerprint from thumbnail URL (helps dedupe when title/URL don’t carry series info)
function thumbKey(item) {
  if (!item.thumb) return null;
  try {
    const u = new URL(item.thumb);
    const base = u.pathname.split("/").filter(Boolean).slice(-1)[0]; // filename
    return `${item.service}:thumb:${base.toLowerCase()}`;
  } catch {
    return null;
  }
}

const TV_SERVICES = new Set(["netflix", "hulu", "disney", "prime", "max", "peacock", "paramount"]);

function seriesKey(item) {
  if (!item || !TV_SERVICES.has(item.service)) return null;

  // 1) Prefer URL-based grouping if we can extract a stable slug/id
  const kUrl = urlSeriesKey(item);
  if (kUrl) return kUrl;

  // 2) Normalize title (even if it didn’t visibly change, still group)
  const norm = normalizeSeriesTitle(item.title) || (item.title || "").trim();
  if (norm) return `${item.service}:title:${norm.toLowerCase()}`;

  // 3) Fallback to thumbnail fingerprint
  const kThumb = thumbKey(item);
  if (kThumb) return kThumb;

  return null;
}

function dedupeSeries(items) {
  const latestBySeries = new Map();
  const keepAsIs = [];

  for (const it of items) {
    const key = seriesKey(it);
    if (!key) {
      keepAsIs.push(it);
      continue;
    }
    const prev = latestBySeries.get(key);
    if (!prev || (it.lastVisited || 0) > (prev.lastVisited || 0)) {
      latestBySeries.set(key, it);
    }
  }

  // Extra safety: drop generic Peacock home/landing pages
  const filtered = [...latestBySeries.values(), ...keepAsIs].filter(it => {
    if (it.service !== "peacock") return true;
    const u = (() => { try { return new URL(it.canonicalUrl || it.url); } catch { return null; } })();
    const path = u?.pathname || "";
    const nonContent = ["/", "/start", "/home", "/browse", "/channels", "/sports", "/kids", "/account"];
    if (nonContent.includes(path)) return false;
    const title = (it.title || "").toLowerCase();
    if (title === "peacock" || title.includes("home - peacock")) return false;
    return true;
  });

  filtered.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return filtered;
}

app.get("/history/all", async (_req, res) => {
  try {
    if (!HISTORY_PATH || !fs.existsSync(HISTORY_PATH)) {
      return res.status(404).json({ error: "Brave history not found", path: HISTORY_PATH || "(auto-detect failed)" });
    }
    const yt = getRecentYouTube(60);
    const others = getRecentForDomains(120);
    let items = [...yt, ...others].sort((a, b) => b.lastVisited - a.lastVisited);

    // Canonicalize and filter non-content pages before enrichment/deduping
    items = normalizeItems(items);

    // Enrich missing thumbnails/titles via OG meta (plus optional TMDb)
    await enrichMeta(items, 40);

    // Collapse older episodes per series across services
    items = dedupeSeries(items);

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

// Browser-like UA to maximize OG/Twitter meta tags
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const metaCache = new Map();
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// fetchItunesArtwork(title, type) — no-key artwork fallback
async function fetchItunesArtwork(title, type = "tv") {
    // ... existing code ...
    if (!title) return null;
    const media = type === "movie" ? "movie" : "tvShow";
    try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=${media}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const hit = Array.isArray(data.results) ? data.results[0] : null;
        if (!hit) return null;
        const art = hit.artworkUrl100 || hit.artworkUrl60 || hit.artworkUrl512 || hit.artworkUrl600;
        if (!art) return null;
        // Upgrade to higher resolution if possible
        const hi = art.replace(/\/\d+x\d+bb\./, "/600x600bb.");
        const finalTitle = hit.trackName || hit.collectionName || title;
        return { title: finalTitle, thumb: hi };
    } catch {
        return null;
    }
}

// fetchTvMazePoster(title) — free TV show artwork fallback
async function fetchTvMazePoster(title) {
  if (!title) return null;
  try {
    const url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const img = data?.image?.original || data?.image?.medium;
    if (!img) return null;
    const finalTitle = data?.name || title;
    return { title: finalTitle, thumb: img };
  } catch {
    return null;
  }
}

// fetchMeta(url) — make OG images absolute if relative
async function fetchMeta(url) {
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": UA,
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,*/*",
                "Referer": "https://www.google.com/"
            },
            redirect: "follow"
        });
        if (!res.ok) return null;
        const html = await res.text();
        const $ = cheerio.load(html);

        const ogTitle =
            $('meta[property="og:title"]').attr("content") ||
            $('meta[name="twitter:title"]').attr("content") ||
            $("title").text().trim();

        let ogImage =
            $('meta[property="og:image"]').attr("content") ||
            $('meta[name="twitter:image"]').attr("content");

        // Make image absolute if site returns a relative URL
        if (ogImage && !/^https?:\/\//i.test(ogImage)) {
            try {
                ogImage = new URL(ogImage, url).toString();
            } catch (_) {}
        }

        return {
            title: ogTitle && ogTitle.length ? ogTitle : null,
            thumb: ogImage && ogImage.length ? ogImage : null
        };
    } catch {
        return null;
    }
}

// inferContentType(item) — decide whether to search as movie or tv show
function inferContentType(item) {
  try {
    const u = new URL(item.canonicalUrl || item.url);
    const p = u.pathname.toLowerCase();
    if (u.hostname.includes("peacocktv.com")) {
      if (p.startsWith("/movies/")) return "movie";
      // watch pages with "episode" wording are tv; otherwise default to tv
      const t = (item.title || "").toLowerCase();
      if (p.startsWith("/shows/") || p.startsWith("/watch") || t.includes("episode")) return "tv";
    }
    if (u.hostname.includes("disneyplus.com") && p.startsWith("/movie/")) return "movie";
    if (u.hostname.includes("max.com") && p.startsWith("/video/")) return "tv";
    if (u.hostname.includes("hulu.com") && p.startsWith("/series/")) return "tv";
    if (u.hostname.includes("paramountplus.com") && p.startsWith("/movies/")) return "movie";
  } catch {}
  // fallback: title heuristics
  const t = (item.title || "").toLowerCase();
  if (t.includes(":")) return "tv"; // many episodes have ':' in titles
  return "movie"; // safe default; tv will still find art in many cases
}

async function fetchTmdbPoster(title) {
  if (!TMDB_API_KEY || !title) return null;
  try {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&include_adult=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data.results) ? data.results[0] : null;
    if (!hit) return null;
    const path = hit.backdrop_path || hit.poster_path;
    if (!path) return null;
    const img = `https://image.tmdb.org/t/p/w780${path}`;
    const finalTitle = hit.name || hit.title || title;
    return { title: finalTitle, thumb: img };
  } catch {
    return null;
  }
}

// inferContentType(item) — decide whether to search as movie or tv show
function inferContentType(item) {
  try {
    const u = new URL(item.canonicalUrl || item.url);
    const p = u.pathname.toLowerCase();
    if (u.hostname.includes("peacocktv.com")) {
      if (p.startsWith("/movies/")) return "movie";
      // watch pages with "episode" wording are tv; otherwise default to tv
      const t = (item.title || "").toLowerCase();
      if (p.startsWith("/shows/") || p.startsWith("/watch") || t.includes("episode")) return "tv";
    }
    if (u.hostname.includes("disneyplus.com") && p.startsWith("/movie/")) return "movie";
    if (u.hostname.includes("max.com") && p.startsWith("/video/")) return "tv";
    if (u.hostname.includes("hulu.com") && p.startsWith("/series/")) return "tv";
    if (u.hostname.includes("paramountplus.com") && p.startsWith("/movies/")) return "movie";
  } catch {}
  // fallback: title heuristics
  const t = (item.title || "").toLowerCase();
  if (t.includes(":")) return "tv"; // many episodes have ':' in titles
  return "movie"; // safe default; tv will still find art in many cases
}

async function fetchTmdbPoster(title) {
  if (!TMDB_API_KEY || !title) return null;
  try {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&include_adult=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data.results) ? data.results[0] : null;
    if (!hit) return null;
    const path = hit.backdrop_path || hit.poster_path;
    if (!path) return null;
    const img = `https://image.tmdb.org/t/p/w780${path}`;
    const finalTitle = hit.name || hit.title || title;
    return { title: finalTitle, thumb: img };
  } catch {
    return null;
  }
}

// enrichMeta(items) — prefer Peacock show/movie pages for art; add iTunes fallback
// enrichMeta(items) — validate Peacock images and never return broken thumbs
async function enrichMeta(items, limit = 40) {
  const tasks = [];
  for (const it of items.slice(0, limit)) {
    // Proceed if missing thumb or thumb is the generic Peacock icon
    const hasGenericPeacock = (it.thumb || "").includes("icons/peacock.png");
    if ((it.thumb && !hasGenericPeacock) && it.title) continue;
    if (!it.url) continue;

    const cacheKey = it.canonicalUrl || it.url;
    const cached = metaCache.get(cacheKey);
    if (cached && !hasGenericPeacock) {
      if (cached?.thumb && !it.thumb) it.thumb = cached.thumb;
      if (cached?.title && (!it.title || it.title === it.service)) it.title = cached.title;
      continue;
    }

    tasks.push(
      (async () => {
        let meta = null;

        // 0) Peacock-direct thumbnail via playback UUID (validate and try variants)
        if (it.service === "peacock" && it.peacockAssetId) {
          const img = await choosePeacockImage(it.peacockAssetId);
          if (img) meta = { title: it.title || null, thumb: img };
        }

        // 1) Choose best URL to scrape OG meta (show/movie slug preferred)
        let urlForMeta = it.url;
        try {
          const u = new URL(it.canonicalUrl || it.url);
          if (it.service === "peacock") {
            if (u.pathname.startsWith("/shows/") || u.pathname.startsWith("/movies/")) {
              urlForMeta = u.toString();
            }
          }
        } catch {}

        // First try OG/Twitter meta
        if (!meta || !meta.thumb) {
          const og = await fetchMeta(urlForMeta);
          if (og) {
            meta = {
              title: meta?.title || og.title || null,
              thumb: meta?.thumb || og.thumb || null
            };
          }
        }

        // Title candidate for fallbacks
        const titleFromUrl = guessTitleFromUrl(it.canonicalUrl || it.url);
        const normalizedTitle =
          normalizeSeriesTitle(it.title) ||
          titleFromUrl ||
          it.title;

        // 2) TMDb fallback (if available)
        if ((!meta || !meta.thumb) && TMDB_API_KEY && it.service !== "youtube") {
          const tmdb = await fetchTmdbPoster(normalizedTitle);
          if (tmdb) {
            meta = { title: meta?.title || tmdb.title, thumb: meta?.thumb || tmdb.thumb };
          }
        }

        // 3) TVMaze for TV shows (no key)
        if ((!meta || !meta.thumb) && it.service !== "youtube") {
          const kind = inferContentType(it);
          if (kind === "tv") {
            const tvm = await fetchTvMazePoster(normalizedTitle);
            if (tvm) {
              meta = { title: meta?.title || tvm.title, thumb: meta?.thumb || tvm.thumb };
            }
          }
        }

        // 4) iTunes fallback (no key) — good for movies
        if ((!meta || !meta.thumb) && it.service !== "youtube") {
          const kind = inferContentType(it);
          if (kind === "movie") {
            const itunes = await fetchItunesArtwork(normalizedTitle, "movie");
            if (itunes) {
              meta = { title: meta?.title || itunes.title, thumb: meta?.thumb || itunes.thumb };
            }
          }
        }

        // Final validation: don’t send broken images to the client
        if (meta?.thumb && !(await validateImage(meta.thumb))) {
          meta.thumb = null;
        }

        metaCache.set(cacheKey, meta || null);

        if (meta?.thumb && (hasGenericPeacock || !it.thumb)) it.thumb = meta.thumb;
        if (meta?.title && (!it.title || it.title === it.service)) it.title = meta.title;
      })()
    );
  }
  await Promise.allSettled(tasks);
}

// Helper: extract a UUID (v4 style) anywhere in a string
function extractUuid(str) {
  const m = String(str).match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : null;
}

// Canonicalize content URLs for dedupe/grouping, but preserve original URL for launching
function canonicalizeItem(item) {
  try {
    const u = new URL(item.url);
    const host = u.hostname;
    const canon = new URL(item.url); // clone
    let changed = false;

    let peacockAssetId = null;

    if (host.includes("peacocktv.com")) {
      const exclude = new Set(["/", "/start", "/home", "/browse", "/channels", "/sports", "/kids", "/account"]);
      if (exclude.has(u.pathname)) return null;

      // Try to extract a UUID-like asset id from path or query, including forms like "vod-<uuid>"
      const rawIdFromPath =
        (u.pathname.match(/\/watch\/(?:playback|asset|play)\/([^\/?#]+)/i) || [])[1];
      const rawIdFromQuery =
        u.searchParams.get("playbackId") ||
        u.searchParams.get("assetId") ||
        u.searchParams.get("asset_id") ||
        u.searchParams.get("id") ||
        u.searchParams.get("cid") ||
        u.searchParams.get("uuid");

      const candidate = rawIdFromPath || rawIdFromQuery;
      // If value includes a prefix like "vod-" or "asset-", strip prefix and extract the UUID
      peacockAssetId = extractUuid(candidate) || extractUuid(item.url);

      // Canonical path normalization (unchanged behavior)
      if (u.pathname.startsWith("/watch")) {
        const mPlayback = u.pathname.match(/\/watch\/playback\/([^\/?#]+)/);
        const mAsset    = u.pathname.match(/\/watch\/asset\/([^\/?#]+)/);
        const mPlay     = u.pathname.match(/\/watch\/play\/([^\/?#]+)/);

        const qpId =
          u.searchParams.get("playbackId") ||
          u.searchParams.get("assetId") ||
          u.searchParams.get("asset_id") ||
          u.searchParams.get("id");

        if (mPlayback) { canon.pathname = `/watch/playback/${mPlayback[1]}`; changed = true; }
        else if (mAsset) { canon.pathname = `/watch/asset/${mAsset[1]}`; changed = true; }
        else if (mPlay) { canon.pathname = `/watch/play/${mPlay[1]}`; changed = true; }
        else if (qpId) { canon.pathname = `/watch/playback/${qpId}`; changed = true; }
        else { canon.pathname = "/watch"; changed = true; }
      } else if (u.pathname.startsWith("/shows/") || u.pathname.startsWith("/movies/")) {
        if (canon.pathname.endsWith("/")) { canon.pathname = canon.pathname.slice(0, -1); changed = true; }
      }

      if (canon.search) { canon.search = ""; changed = true; }
    }

    return {
      ...item,
      canonicalUrl: changed ? canon.toString() : item.url,
      peacockAssetId
    };
  } catch {
    return { ...item, canonicalUrl: item.url };
  }
}

// Normalize a collection of items (canonicalize + remove nulls)
function normalizeItems(items) {
  return items
    .map(it => canonicalizeItem(it))
    .filter(Boolean);
}

// guessTitleFromUrl(url) — derive a reasonable series/movie title from known slugs
function guessTitleFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const segs = u.pathname.toLowerCase().split("/").filter(Boolean);

    // Peacock
    if (u.hostname.includes("peacocktv.com")) {
      if (segs[0] === "shows" || segs[0] === "movies") {
        const slug = segs[1] || "";
        return decodeURIComponent(slug).replace(/-/g, " ").trim();
      }
      return null;
    }

    // Hulu, Disney+, Max, Paramount+ — common series/movie slug shapes
    const seriesShapes = [
      { host: "hulu.com", prefix: "series" },
      { host: "disneyplus.com", prefix: "series" },
      { host: "max.com", prefix: "series" },
      { host: "paramountplus.com", prefix: "shows" }
    ];
    for (const s of seriesShapes) {
      if (u.hostname.includes(s.host) && segs[0] === s.prefix) {
        const slug = segs[1] || "";
        return decodeURIComponent(slug).replace(/-/g, " ").trim();
      }
    }

    const movieShapes = [
      { host: "disneyplus.com", prefix: "movie" },
      { host: "peacocktv.com", prefix: "movies" }
    ];
    for (const s of movieShapes) {
      if (u.hostname.includes(s.host) && segs[0] === s.prefix) {
        const slug = segs[1] || "";
        return decodeURIComponent(slug).replace(/-/g, " ").trim();
      }
    }
  } catch {}
  return null;
}

// Build a Peacock image-service URL from a playback UUID
function peacockImageFromAssetId(assetId, opts = {}) {
  if (!assetId) return null;
  const variant = opts.variant || "COVER_TITLE_WIDE"; // landscape fits your cards
  const size = opts.size || "780x439";
  const quality = opts.quality || 85;
  const fmt = opts.format || "webp";
  const lang = opts.language || "eng";
  const prop = opts.proposition || "NBCUOTT";
  const version = opts.version ? `&version=${opts.version}` : "";

  return `https://imageservice.disco.peacocktv.com/uuid/${assetId}/${variant}/${size}?image-quality=${quality}&image-format=${fmt}&language=${lang}&proposition=${prop}${version}`;
}

// Try multiple Peacock variants/sizes and return the first that validates
async function choosePeacockImage(assetId) {
  const candidates = [
    peacockImageFromAssetId(assetId, { variant: "COVER_TITLE_WIDE", size: "780x439" }),
    peacockImageFromAssetId(assetId, { variant: "COVER_TITLE_WIDE", size: "1280x720" }),
    peacockImageFromAssetId(assetId, { variant: "COVER_TITLE_TALL", size: "600x900" })
  ];
  for (const url of candidates) {
    if (url && await validateImage(url)) return url;
  }
  return null;
}

// validateImage(url) — check if an image URL is actually fetchable
async function validateImage(url) {
  // Some CDNs block HEAD; try HEAD first, then a tiny GET range request
  const head = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (head.ok) return true;
  const get = await fetch(url, {
    method: "GET",
    headers: { "Range": "bytes=0-0", "Accept": "image/*" },
    redirect: "follow"
  });
  return get.ok;
}