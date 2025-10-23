const { queryRows, webkitTimeToMs, RECENCY_MS } = require("../utils/db");

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

module.exports = { getRecentYouTube };