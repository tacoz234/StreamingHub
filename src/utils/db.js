const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const HISTORY_DIR = `${process.env.HOME}/Library/Application Support/BraveSoftware/Brave-Browser`;

function webkitTimeToMs(webkitMicroseconds) {
  const EPOCH_DIFF_MS = 11644473600000;
  return Math.floor(webkitMicroseconds / 1000) - EPOCH_DIFF_MS;
}

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
  } catch {}
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

const HISTORY_PATH = findHistoryFile();
const RECENCY_DAYS = Number(process.env.RECENCY_DAYS || 14);
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

// NEW: active path override
let ACTIVE_HISTORY_PATH = null;
function setActiveHistoryPath(p) { ACTIVE_HISTORY_PATH = p || null; }
function getActiveHistoryPath() { return ACTIVE_HISTORY_PATH || HISTORY_PATH; }

// NEW: read profile names from Brave's Local State
function readProfileNames() {
  const statePath = path.join(HISTORY_DIR, "Local State");
  const names = {};
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const json = JSON.parse(raw);
    // Brave/Chrome store friendly names here
    const info = (json && json.profile && json.profile.info_cache) || {};
    for (const key of Object.keys(info)) {
      const label = info[key]?.name;
      if (label) names[key] = String(label);
    }
  } catch {
    // ignore; fall back to directory IDs
  }
  return names;
}

// NEW: list available Brave profiles with display labels
function listProfiles() {
  const out = [];
  const labels = readProfileNames();
  try {
    const dirs = fs.readdirSync(HISTORY_DIR).filter(d => d === "Default" || d.startsWith("Profile"));
    for (const d of dirs) {
      const p = path.join(HISTORY_DIR, d, "History");
      if (!fs.existsSync(p)) continue;
      const stat = fs.statSync(p);
      out.push({
        id: d,              // e.g., "Default", "Profile 1"
        label: labels[d] || d, // user-friendly name if available
        path: p,
        mtimeMs: stat.mtimeMs
      });
    }
  } catch {}
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function safeCopy(src) {
  const tmpDir = path.join(__dirname, "..", "..", "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const dest = path.join(tmpDir, "BraveHistory.sqlite");
  fs.copyFileSync(src, dest);
  return dest;
}

function queryRows(sql, params = []) {
  const source = getActiveHistoryPath();
  if (!source) throw new Error("Brave history file not found");
  const copyPath = safeCopy(source);
  const db = new Database(copyPath, { readonly: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}

module.exports = {
  HISTORY_PATH,
  RECENCY_DAYS,
  RECENCY_MS,
  webkitTimeToMs,
  queryRows,
  // NEW exports
  listProfiles,
  setActiveHistoryPath,
  getActiveHistoryPath
};