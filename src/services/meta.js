const cheerio = require("cheerio");
const { queryRows } = require("../utils/db");
const { titlesLooseMatch, normalizeSeriesTitle, guessTitleFromUrl } = require("./grouping");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const metaCache = new Map();
const TMDB_API_KEY = process.env.TMDB_API_KEY;

async function fetchItunesArtwork(title, type = "tv") {
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
    const hi = art.replace(/\/\d+x\d+bb\./, "/600x600bb.");
    const finalTitle = hit.trackName || hit.collectionName || title;
    return { title: finalTitle, thumb: hi };
  } catch {
    return null;
  }
}

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

    let ogImageSecure = $('meta[property="og:image:secure_url"]').attr("content");
    let ogImage =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content");

    let ldTitle = null;
    let ldImage = null;
    try {
      $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).text();
        try {
          const data = JSON.parse(raw);
          const arr = Array.isArray(data) ? data : [data];
          for (const obj of arr) {
            const t = obj && obj['@type'];
            if (t && ["Movie", "TVSeries", "TVEpisode", "VideoObject"].includes(t)) {
              if (!ldTitle && obj.name) ldTitle = String(obj.name).trim();
              const img = obj.image;
              if (!ldImage && img) {
                ldImage = Array.isArray(img) ? img[0] : img;
              }
            }
          }
        } catch {}
      });
    } catch {}

    function absolutize(img) {
      if (!img) return null;
      if (/^https?:\/\//i.test(img)) return img;
      try { return new URL(img, url).toString(); } catch { return null; }
    }
    ogImageSecure = absolutize(ogImageSecure);
    ogImage = absolutize(ogImage);
    ldImage = absolutize(ldImage);

    const finalTitle = (ogTitle && ogTitle.length ? ogTitle : null) || (ldTitle && ldTitle.length ? ldTitle : null);
    const finalImage = (ogImageSecure && ogImageSecure.length ? ogImageSecure : null) ||
                       (ogImage && ogImage.length ? ogImage : null) ||
                       (ldImage && ldImage.length ? ldImage : null);

    return { title: finalTitle, thumb: finalImage };
  } catch {
    return null;
  }
}

function inferContentType(item) {
  try {
    const u = new URL(item.canonicalUrl || item.url);
    const p = u.pathname.toLowerCase();
    if (u.hostname.includes("peacocktv.com")) {
      if (p.startsWith("/movies/")) return "movie";
      const t = (item.title || "").toLowerCase();
      if (p.startsWith("/shows/") || p.startsWith("/watch") || t.includes("episode")) return "tv";
    }
    if (u.hostname.includes("disneyplus.com") && p.startsWith("/movie/")) return "movie";
    if (u.hostname.includes("max.com") && p.startsWith("/video/")) return "tv";
    if (u.hostname.includes("hulu.com") && p.startsWith("/series/")) return "tv";
    if (u.hostname.includes("paramountplus.com") && p.startsWith("/movies/")) return "movie";
  } catch {}
  const t = (item.title || "").toLowerCase();
  if (t.includes(":")) return "tv";
  return "movie";
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

function peacockImageFromAssetId(assetId, opts = {}) {
  if (!assetId) return null;
  const variant = opts.variant || "COVER_TITLE_WIDE";
  const size = opts.size || "780x439";
  const quality = opts.quality || 85;
  const fmt = opts.format || "webp";
  const lang = opts.language || "eng";
  const prop = opts.proposition || "NBCUOTT";
  const version = opts.version ? `&version=${opts.version}` : "";
  return `https://imageservice.disco.peacocktv.com/uuid/${assetId}/${variant}/${size}?image-quality=${quality}&image-format=${fmt}&language=${lang}&proposition=${prop}${version}`;
}

async function validateImage(url) {
  try {
    const head = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": UA,
        "Accept": "image/*",
        "Referer": "https://www.google.com/"
      },
      redirect: "follow"
    });
    if (head.ok) return true;
  } catch {}
  try {
    const get = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "image/*",
        "Range": "bytes=0-0",
        "Referer": "https://www.google.com/"
      },
      redirect: "follow"
    });
    return get.ok;
  } catch {
    return false;
  }
}

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

function findHuluContextUrl(watchUrl) {
  try {
    const rows = queryRows(`
      SELECT v.id, v.from_visit, u.url AS url, u2.url AS from_url
      FROM visits v
      JOIN urls u ON v.url = u.id
      LEFT JOIN visits pv ON pv.id = v.from_visit
      LEFT JOIN urls u2 ON pv.url = u2.id
      WHERE u.url = ?
      ORDER BY v.visit_time DESC
      LIMIT 1
    `, [watchUrl]);

    if (!rows.length) return null;

    let curFromId = rows[0].from_visit;
    for (let i = 0; i < 5 && curFromId; i++) {
      const hop = queryRows(`
        SELECT v.id, v.from_visit, u.url AS url
        FROM visits v
        JOIN urls u ON v.url = u.id
        WHERE v.id = ?
        LIMIT 1
      `, [curFromId])[0];

      if (!hop) break;
      curFromId = hop.from_visit;

      try {
        const u = new URL(hop.url);
        if (!u.hostname.includes("hulu.com")) continue;
        const p = u.pathname.toLowerCase();
        if (p.startsWith("/movie/") || p.startsWith("/series/")) {
          return hop.url;
        }
      } catch {}
    }
  } catch {}
  return null;
}

async function enrichMeta(items, limit = 40) {
  const tasks = [];
  for (const it of items.slice(0, limit)) {
    const hasGenericPeacock = (it.thumb || "").includes("icons/peacock.png");
    if ((it.thumb && !hasGenericPeacock) && it.title) continue;
    if (!it.url) continue;

    const cacheKey = `${it.service}:${it.peacockAssetId || ""}:${it.canonicalUrl || it.url}`;
    const cached = metaCache.get(cacheKey);
    if (cached && !hasGenericPeacock) {
      if (cached?.thumb && !it.thumb) it.thumb = cached.thumb;
      if (cached?.title && (!it.title || it.title === it.service)) it.title = cached.title;
      continue;
    }

    tasks.push((async () => {
      let meta = null;

      if (it.service === "peacock" && it.peacockAssetId) {
        const img = await choosePeacockImage(it.peacockAssetId);
        if (img) meta = { title: it.title || null, thumb: img };
      }

      let urlForMeta = it.url;
      let huluContextUrl = null;
      try {
        const u = new URL(it.canonicalUrl || it.url);
        if (it.service === "peacock") {
          if (u.pathname.startsWith("/shows/") || u.pathname.startsWith("/movies/")) {
            urlForMeta = u.toString();
          }
        } else if (it.service === "hulu") {
          const p = u.pathname.toLowerCase();
          if (p.startsWith("/movie/") || p.startsWith("/series/")) {
            urlForMeta = u.toString();
          } else if (p.startsWith("/watch/")) {
            huluContextUrl = findHuluContextUrl(u.toString());
            if (huluContextUrl) urlForMeta = huluContextUrl;
          }
        } else if (it.service === "netflix") {
          const mWatch = u.pathname.match(/\/watch\/(\d+)/);
          if (mWatch) {
            urlForMeta = `https://www.netflix.com/title/${mWatch[1]}`;
          } else if (u.pathname.startsWith("/title/")) {
            urlForMeta = u.toString();
          }
        } else if (it.service === "prime") {
          if (u.hostname.includes("primevideo.com")) {
            if (u.pathname.startsWith("/detail/") || u.pathname.startsWith("/watch/")) {
              urlForMeta = u.toString();
            }
          } else if (u.hostname.includes("amazon.com")) {
            const p = u.pathname.toLowerCase();
            if (p.startsWith("/gp/video/detail/") ||
                p.startsWith("/gp/video/title/") ||
                p.startsWith("/gp/video/play/")) {
              urlForMeta = u.toString();
            }
          }
        }
      } catch {}

      if (!meta || !meta.thumb) {
        const og = await fetchMeta(urlForMeta);
        if (og) {
          meta = {
            title: meta?.title || og.title || null,
            thumb: meta?.thumb || og.thumb || null
          };
        }
      }

      const titleFromUrl = guessTitleFromUrl(it.canonicalUrl || it.url);
      let expectedTitle =
        normalizeSeriesTitle(it.title) ||
        titleFromUrl ||
        it.title;

      if ((!meta || !meta.thumb) && TMDB_API_KEY && it.service !== "youtube") {
        const tmdb = await fetchTmdbPoster(expectedTitle);
        if (tmdb && titlesLooseMatch(expectedTitle, tmdb.title)) {
          meta = {
            title: meta?.title || tmdb.title,
            thumb: meta?.thumb || tmdb.thumb
          };
        }
      }

      if ((!meta || !meta.thumb) && it.service !== "youtube") {
        const kind = inferContentType(it);
        if (kind === "tv") {
          const tvm = await fetchTvMazePoster(expectedTitle);
          if (tvm && titlesLooseMatch(expectedTitle, tvm.title)) {
            meta = {
              title: meta?.title || tvm.title,
              thumb: meta?.thumb || tvm.thumb
            };
          }
        } else {
          const itunes = await fetchItunesArtwork(expectedTitle, "movie");
          if (itunes && titlesLooseMatch(expectedTitle, itunes.title)) {
            meta = {
              title: meta?.title || itunes.title,
              thumb: meta?.thumb || itunes.thumb
            };
          }
        }
      }

      if (meta?.thumb) {
        // Prime/Max CDNs commonly block HEAD/range probes; trust OG/TMDB URLs.
        let ok = true;
        if (it.service !== "prime" && it.service !== "max") {
          ok = await validateImage(meta.thumb);
        }
        if (!ok) meta.thumb = null;
      }

      metaCache.set(cacheKey, meta || null);

      if (meta?.thumb && (hasGenericPeacock || !it.thumb)) it.thumb = meta.thumb;
      if (meta?.title && (!it.title || it.title === it.service)) it.title = meta.title;
    })());
  }
  await Promise.allSettled(tasks);
}

module.exports = {
  UA,
  metaCache,
  fetchMeta,
  fetchTvMazePoster,
  fetchItunesArtwork,
  fetchTmdbPoster,
  inferContentType,
  enrichMeta
};