# VitPlotter — Frontend

Vue 3 + Vite + uPlot. Catppuccin Latte (light) / Mocha (dark) theming.

## Run

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> (in dev, `/api` is proxied to the backend on <http://localhost:8000>).

## Build

```bash
npm run build   # outputs to frontend/dist; the backend serves it automatically when present
```

## Structure

- `src/components/FileDropZone.vue` — file picker + drag-and-drop
- `src/components/StreamConnect.vue` — UDP host/port connect form
- `src/components/SeriesSelector.vue` — toggle which series are shown
- `src/components/PlotChart.vue` — uPlot chart wrapper (CSV + live modes)
- `src/api.js` — CSV upload call
- `src/stream.js` — `useUdpStream()` composable: WebSocket client + rolling buffer
- `src/theme.js` — light/dark theme state (persisted, follows system preference)
- `src/palette.js` — series/axis colors per theme
- `src/styles/theme.css` — semantic theme tokens and global styles
