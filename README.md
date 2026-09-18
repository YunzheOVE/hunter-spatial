# Hunter Spatial

Indoor wayfinding for CUNY Hunter College (68th Street). Students pick a building and floor, search a room code, and (after Milestone 1) see the real floor plan in MapLibre.

See [plan.md](plan.md) for architecture and milestones.

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

Open [http://localhost:3000](http://localhost:3000). Search `N304` or pick a building and floor. The indoor map is empty until GeoJSON is extracted.

```bash
npm test          # from apps/web
```

## Folders

- [plan.md](plan.md) — stages and data rules
- `apps/web` — the website
- `scripts/` — HAR extract and GeoJSON convert (Milestone 1)
- `data/` — local HAR only (gitignored); do not commit `.har` or `data/raw/`
