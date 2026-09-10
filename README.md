# Hunter Spatial

Interactive 3D campus navigator for CUNY Hunter College (68th Street).

## Run

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Pick a building, then a floor. North Building floor 3 (`*`) loads the hallway scan. Search `N304` to drop the door marker.

```bash
npm test          # from apps/web
python scripts/extract_campus.py
python scripts/generate_glb.py
```

## Layout

- `docs/superpowers/specs/2026-09-09-hunter-spatial-design.md` — coordinate system, JSON, GLB rules
- `data/` — `campus.json`, `rooms.json`, OSM extract
- `assets/glb/` — campus skeleton + North Building floor-3 scan placeholder
- `apps/web` — Next.js + React Three Fiber viewer
