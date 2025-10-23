# Brave Streaming Hub

A lightweight, single-page hub for quick access to streaming services and a “Continue Watching” row that merges local YouTube progress with your browser history.

## Features

- Service tiles for common streaming platforms with branded icons and gradients.
- Continue Watching row that combines:
  - YouTube videos played inside the hub (with saved progress and duration).
  - Recent items from your Brave browsing history (YouTube + major services).
- YouTube inline player (Shift-click a YouTube entry) that saves `progress` and `duration` locally to drive real progress bars.
- Accessibility: tiles are links (not buttons) to avoid duplicate “button button” announcements; service captions shown below each app card.

## Requirements

- Node.js (v18+ recommended) for the history API.
- macOS (tested) for Brave profile auto-detection in `history_server.js`.
- A static file server to serve `index.html` (or open locally if your browser allows module scripts via `file://`).

## Install

Install server dependencies (used by `history_server.js`):

```bash
npm install
```

## Run

Start the Brave history API on `http://localhost:5607`:

```bash
node history_server.js
```

Serve the frontend (for example with Python):

```bash
python3 -m http.server 8080
```

Open the hub:

```bash
open http://localhost:8080/
```

## Usage

- All Apps: click a tile to open the streaming service (Cmd-click opens in a new tab).
- Continue Watching:
  - YouTube entries with progress are saved locally by the inline player.
  - Brave history items show thumbnails and service labels. Progress bars only render when `progress` and `duration` are present.
- YouTube inline:
  - Shift-click a YouTube item in Continue Watching to play inside the hub.
  - The hub saves progress every ~1.5s and on pause/end.
  - The saved progress auto-populates the YouTube “Continue” tile’s resume URL.

## Data & Storage

- Local storage keys:
  - `hub_recent_services` — last visited app tiles.
  - `hub_recent_videos` — YouTube entries with `{ id, title, thumb, progress, duration, updatedAt }`.
- Brave history API:
  - `GET http://localhost:5607/history/all` returns recent items with `service`, `url`, `id` (for YouTube), `title` (when available), and `thumb`.

## Project Structure

- `index.html` — page shell and modal container for YouTube.
- `styles.css` — styles for tiles, continue row, and modal.
- `app.js` — frontend logic:
  - Renders service grid and continue row.
  - Inline YouTube player, local progress saving.
  - Normalizes history items and thumbnails.
- `history_server.js` — Node server:
  - Serves the Brave aggregated history API on `http://localhost:5607`.
  - Enriches metadata for Hulu/Netflix by mapping watch pages to title pages when possible.

## Notes & Tips

- Progress bars:
  - Work for YouTube items played via the hub’s inline player (we store `progress` and `duration`).
  - Other services don’t expose playback time to the hub; bars are hidden unless timing exists.
- If the “Continue Watching” section is empty, ensure the history server is running and you’ve watched something recently.
- If you see generic titles like “Hulu | Watch”, the server attempts to map to content pages and pull better metadata. Some titles may still depend on fallback APIs.

## Roadmap

- Browser extension to capture `video.currentTime` and `duration` on Netflix/Hulu/Prime for real progress bars.
- Additional metadata sources and heuristics for title/artwork enrichment.
- Optional pinned rows or sections.

## License

ISC (see `package.json`).