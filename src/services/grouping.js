function normalizeSeriesTitle(raw) {
  if (!raw) return null;
  let t = String(raw);
  t = t.replace(/\bS\d{1,2}\s*[:x]?\s*E\d{1,3}\b/gi, "");
  t = t.replace(/\bS\d{1,2}E\d{1,3}\b/gi, "");
  t = t.replace(/\bSeason\s*\d+\b/gi, "");
  t = t.replace(/\bEpisode\s*\d+\b/gi, "");
  t = t.replace(/\bEp\.?\s*\d+\b/gi, "");
  t = t.replace(/\bChapter\s*\d+\b/gi, "");
  t = t.replace(/\bPart\s*\d+\b/gi, "");
  t = t.replace(/\(\s*(S\d+\s*[:x]?\s*E\d+|Episode\s*\d+|Ep\.?\s*\d+)\s*\)/gi, "");
  t = t.replace(/\s*[•\-–—|:]\s*Peacock\b/gi, "");
  t = t.replace(/\b(Superfan Episodes|Extras|Bonus|Extended Cut|Director'?s Cut|Unrated|Extended)\b/gi, "");
  t = t.replace(/\s*[•\-–—|:]\s*/g, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t.length ? t : null;
}

function urlSeriesKey(item) {
  try {
    const u = new URL(item.canonicalUrl || item.url);
    const p = u.pathname.toLowerCase();

    if (u.hostname.includes("peacocktv.com")) {
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
  } catch {}
  return null;
}

function thumbKey(item) {
  if (!item.thumb) return null;
  try {
    const u = new URL(item.thumb);
    const base = u.pathname.split("/").filter(Boolean).slice(-1)[0];
    return `${item.service}:thumb:${base.toLowerCase()}`;
  } catch {
    return null;
  }
}

const TV_SERVICES = new Set(["netflix", "hulu", "disney", "prime", "max", "peacock", "paramount"]);

function seriesKey(item) {
  if (!item || !TV_SERVICES.has(item.service)) return null;
  const kUrl = urlSeriesKey(item);
  if (kUrl) return kUrl;
  const norm = normalizeSeriesTitle(item.title) || (item.title || "").trim();
  if (norm) return `${item.service}:title:${norm.toLowerCase()}`;
  if (item.service !== "peacock") {
    const kThumb = thumbKey(item);
    if (kThumb) return kThumb;
  }
  return null;
}

function canonicalTitle(t) {
  if (!t) return "";
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function titlesLooseMatch(expected, candidate) {
  expected = canonicalTitle(expected);
  candidate = canonicalTitle(candidate);
  if (!expected || !candidate) return false;
  const expTokens = expected.split(" ").filter(Boolean);
  const candTokens = new Set(candidate.split(" ").filter(Boolean));
  const hits = expTokens.filter(tok => candTokens.has(tok)).length;
  const ratio = hits / expTokens.length;
  const contains = candidate.includes(expected) || expected.includes(candidate);
  return ratio >= 0.5 || contains;
}

function guessTitleFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const segs = u.pathname.toLowerCase().split("/").filter(Boolean);
    if (u.hostname.includes("peacocktv.com")) {
      if (segs[0] === "shows" || segs[0] === "movies") {
        const slug = segs[1] || "";
        return decodeURIComponent(slug).replace(/-/g, " ").trim();
      }
      return null;
    }
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
    if (u.hostname.includes("hulu.com") && segs[0] === "movie" && segs[1]) {
      const slug = segs[1];
      return decodeURIComponent(slug).replace(/-/g, " ").trim();
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
    if (u.hostname.includes("amazon.com") &&
        segs[0] === "gp" && segs[1] === "video" && segs[2] === "title" && segs[3]) {
      const slug = segs[3];
      return decodeURIComponent(slug).replace(/-/g, " ").trim();
    }
  } catch {}
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

  const filtered = [...latestBySeries.values(), ...keepAsIs].filter(it => {
    if (it.service === "peacock") {
      const u = (() => { try { return new URL(it.canonicalUrl || it.url); } catch { return null; } })();
      const path = u?.pathname || "";
      const nonContent = ["/", "/start", "/home", "/browse", "/channels", "/sports", "/kids", "/account"];
      const title = (it.title || "").toLowerCase();
      if (nonContent.includes(path)) return false;
      if (title === "peacock" || title.includes("home - peacock")) return false;
      return true;
    }
    if (it.service === "prime") {
      const u = (() => { try { return new URL(it.canonicalUrl || it.url); } catch { return null; } })();
      const path = u?.pathname || "";
      const title = (it.title || "").toLowerCase();
      if (path.startsWith("/Amazon-Video/b/")) return false;
      if (path.startsWith("/gp/video/storefront")) return false;
      if (title === "prime video") return false;
    }
    return true;
  });

  filtered.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return filtered;
}

module.exports = {
  normalizeSeriesTitle,
  urlSeriesKey,
  thumbKey,
  seriesKey,
  dedupeSeries,
  canonicalTitle,
  titlesLooseMatch,
  guessTitleFromUrl
};