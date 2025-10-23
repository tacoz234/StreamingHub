function extractUuid(str) {
  const m = String(str || "").match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : null;
}

function canonicalizeItem(item) {
  try {
    const u = new URL(item.url);
    const host = u.hostname;
    const canon = new URL(item.url);
    let changed = false;

    let peacockAssetId = null;

    if (host.includes("peacocktv.com")) {
      const exclude = new Set(["/", "/start", "/home", "/browse", "/channels", "/sports", "/kids", "/account"]);
      if (exclude.has(u.pathname)) return null;

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
      peacockAssetId = extractUuid(candidate) || extractUuid(item.url) || null;

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
      } else if (u.pathname.startsWith("/shows/") || u.pathname.startsWith("/movies/")) {
        if (canon.pathname.endsWith("/")) { canon.pathname = canon.pathname.slice(0, -1); changed = true; }
      }

      if (changed && canon.search) { canon.search = ""; }
    } else if (host.includes("primevideo.com")) {
      const mDetail = u.pathname.match(/\/detail\/([^\/?]+)/);
      if (mDetail) {
        canon.pathname = `/detail/${mDetail[1]}`;
        changed = true;
      } else {
        const mWatch = u.pathname.match(/\/watch\/([^\/?]+)/);
        if (mWatch) {
          canon.pathname = `/watch/${mWatch[1]}`;
          changed = true;
        }
      }
      if (changed && canon.search) { canon.search = ""; }
    } else if (host.includes("amazon.com")) {
      const m = u.pathname.match(/\/gp\/video\/(?:detail|title|play)\/([^\/?]+)/);
      if (m) {
        canon.pathname = `/gp/video/detail/${m[1]}`;
        changed = true;
        if (canon.search) canon.search = "";
      }
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

function normalizeItems(items) {
  return items.map(it => canonicalizeItem(it)).filter(Boolean);
}

module.exports = { extractUuid, canonicalizeItem, normalizeItems };