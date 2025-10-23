const { queryRows, webkitTimeToMs, RECENCY_MS } = require("../utils/db");
const { canonicalizeItem } = require("./canonical");

function findPrimeForwardContext(startVisitId, maxDepth = 5) {
  try {
    let frontier = [startVisitId];
    const seen = new Set(frontier);
    for (let depth = 0; depth < maxDepth; depth++) {
      const nextFrontier = [];
      for (const id of frontier) {
        const children = queryRows(`
          SELECT v.id AS id, u.url AS url
          FROM visits v
          JOIN urls u ON v.url = u.id
          WHERE v.from_visit = ?
          ORDER BY v.visit_time DESC
          LIMIT 6
        `, [id]);

        for (const child of children) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          nextFrontier.push(child.id);
          try {
            const u = new URL(child.url);
            const p = u.pathname.toLowerCase();
            if (u.hostname.includes("primevideo.com")) {
              if (p.startsWith("/detail/") || p.startsWith("/watch/")) {
                return child.url;
              }
            } else if (u.hostname.includes("amazon.com")) {
              if (p.startsWith("/gp/video/detail/") ||
                  p.startsWith("/gp/video/title/") ||
                  p.startsWith("/gp/video/play/")) {
                return child.url;
              }
            }
          } catch {}
        }
      }
      frontier = nextFrontier;
      if (!frontier.length) break;
    }
  } catch {}
  return null;
}

function getRecentForDomains(limit = 80) {
  const domains = [
    { service: "netflix",   match: "netflix.com",       prefer: [/\/watch\/\d+/, /\/title\/\d+/] },
    { service: "hulu",      match: "hulu.com",          prefer: [/\/watch\/[A-Za-z0-9]+/, /\/series\/[^\/]+/, /\/movie\/[^\/]+/] },
    { service: "disney",    match: "disneyplus.com",    prefer: [/\/video\/[A-Za-z0-9-]+/, /\/player\/[A-Za-z0-9-]+/, /\/movies\/[^\/]+(?:\/[A-Za-z0-9-]+)?/, /\/series\/[^\/]+(?:\/[A-Za-z0-9-]+)?/, /\/details\/[^\/?]+/, /\/browse\/entity-[A-Za-z0-9-]+/, /[?&](entityId|contentId|videoId)=/] },
    { service: "prime",     match: "primevideo.com",    prefer: [/\/detail\/[^\/]+/, /\/watch\/[^\/?]+/] },
    { service: "prime",     match: "amazon.com",        prefer: [
        /\/gp\/video\/detail\/[^\/?]+/,
        /\/gp\/video\/title\/[^\/?]+/,
        /\/gp\/video\/play\/[^\/?]+/
      ] },
    { service: "max",       match: "max.com",           prefer: [/\/video\/[A-Za-z0-9-]+/, /\/series\/[^\/]+/, /\/movie\/[^\/]+/] },
    { service: "peacock",   match: "peacocktv.com" },
    { service: "paramount", match: "paramountplus.com", prefer: [/\/shows\/.+\/video\/[A-Za-z0-9]+/, /\/movies\/[^\/]+\/[A-Za-z0-9]+/, /\/shows\/[^\/]+/] }
  ];

  const rows = queryRows(`
    SELECT urls.url AS url, urls.title AS title,
           visits.visit_time AS visit_time,
           visits.id AS visit_id, visits.from_visit AS from_visit
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
      let u = new URL(r.url);
      const host = u.hostname;
      const domainConf = domains.find(d => host.includes(d.match));
      if (!domainConf) continue;

      if (host.includes("peacocktv.com")) {
        const nonContent = new Set(["/", "/start", "/home", "/browse", "/channels", "/sports", "/kids", "/account"]);
        if (nonContent.has(u.pathname)) continue;
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
        const pathWithSearch = u.pathname + (u.search || "");
        let isPreferred = domainConf.prefer?.some(rx => rx.test(pathWithSearch)) ?? true;

        if (!isPreferred && domainConf.service === "prime") {
          const forwardUrl = findPrimeForwardContext(r.visit_id);
          if (forwardUrl) {
            u = new URL(forwardUrl);
            isPreferred = true;
          }
        }

        if (!isPreferred) continue;
      }

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

module.exports = { getRecentForDomains };