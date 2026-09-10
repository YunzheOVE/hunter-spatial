# Hunter Spatial

A 3D map of CUNY Hunter College (68th Street). Students pick a building and floor, see a hallway, and get a pin at the classroom door.

## Stack

| Part | Tool | Role |
|------|------|------|
| Website | Next.js (React) | Pages, sidebar, search |
| 3D view | React Three Fiber (Three.js) | Interactive campus |
| Map + rooms | `data/campus.json`, `data/rooms.json` | Buildings, floors, pins |
| 3D files | Blender → `.glb` | Campus model |
| Hallway look | Polycam (iPhone) | Scan of a real floor |
| Paths (later) | A* algorithm in the browser | Walk to class |
| Chat (later) | FastAPI + Chroma | Hunter answers + a room pin |

## Run

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Pick a building, then a floor. North Building floor 3 (`*`) loads the hallway scan. Search `N304` for the door pin.

```bash
npm test          # from apps/web
```

## Folders

- [plan.md](plan.md) — stages and next steps
- `docs/superpowers/specs/` — coordinates and file rules
- `data/` — campus and room lists (edit these, not the copies under `apps/web`)
- `assets/glb/` — 3D files the site copies on `npm run dev`
- `apps/web` — the website
