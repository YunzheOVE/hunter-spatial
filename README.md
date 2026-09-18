# Hunter Spatial

Indoor wayfinding for CUNY Hunter College (68th Street). Students pick a building and floor, search a room code, and see the extruded floor plan in MapLibre.

See [plan.md](plan.md) for architecture and milestones. Geometry comes from a one-time HAR extract ([data/SOURCE.md](data/SOURCE.md)).

## Stack

| Part | Tool | Role |
|------|------|------|
| Website | Next.js (React) | Pages, sidebar, search |
| Map (Milestone 1) | MapLibre GL JS | Extruded indoor floor plans |
| Room codes | `parseRoomId` | `HN 304` → building / floor |
| Paths (later) | `ngraph.path` A* | Walk to class |
| Look (later) | Pannellum | 360° hubs |
| Chat (later) | FastAPI + Chroma | Hunter answers + a room id |

## Run

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Search `N304` or pick a building and floor.

```bash
python scripts/extract_har.py          # HAR -> data/raw/ (gitignored)
python scripts/convert_to_geojson.py   # -> apps/web/public/data/hunter-floors.geojson
npm test                               # from apps/web
```

## Folders

- [plan.md](plan.md) — stages and data rules
- `apps/web` — the website
- `scripts/` — HAR extract and GeoJSON convert (Milestone 1)
- `data/` — local HAR only (gitignored); do not commit `.har` or `data/raw/`
