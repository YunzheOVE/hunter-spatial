# Hunter Spatial — project plan

An interactive indoor wayfinding and campus assistant for CUNY Hunter College (68th Street).

Students look around campus in 2.5D, switch floors, search rooms, walk to scheduled classes, and open photorealistic 360° views of a few hub locations.

This is **not** Google Maps outdoors. It is buildings, floors, and hallways. It is also **not** a walk-through 3D mesh (Jane Street / Polycam). The map is an extruded floor plan; the photorealistic look is a handful of 360° portals.

**Floor and room source:** [Hunter’s 68th Street map](https://www.hunter.cuny.edu/about/campus-information/68th-street-campus/map/) (Mappedin), copied **once** from a saved network archive. The live app never talks to Mappedin.

---

## Architectural overview

The renderer is **open source**. The indoor geometry is **not**.

| Piece | What we use | Notes |
|--------|-------------|--------|
| **Map** | MapLibre GL JS `fill-extrusion` on vector GeoJSON | Open source |
| **Look** | Pannellum 360° photospheres (`.webp`) | Viewer is OSS; photos are ours |
| **Pathfinding** | `ngraph.path` (A*) on an extracted walkable graph | We copy the graph, not Mappedin’s JavaScript |
| **Schedule** | Client-side `.ics` parse + existing `parseRoomId` | No CUNYFirst login |
| **Assistant (later)** | FastAPI + Chroma RAG | Returns a room id the map already knows |

Keep the Next.js app shell ([`apps/web/src/components/CampusApp.tsx`](apps/web/src/components/CampusApp.tsx)), [`parseRoomId.ts`](apps/web/src/lib/parseRoomId.ts), and Vitest tests. Add a MapLibre `MapView` in Milestone 1. Do not bring Three.js back.

---

## Two layers (do not mix them)

| Layer | What it is | How it is implemented |
|--------|------------|------------------------|
| **Map** | Building perimeters, floors, walls, hallways, room polygons, path lines | Extracted GeoJSON rendered with MapLibre (`fill-extrusion`) |
| **Look** | Photorealistic interiors at a few hubs (Library, Cafeteria, Skybridge) | Our 360° equirectangular photos in a Pannellum modal |

They share a **room code** (`N304`, `HN 304`). Search, schedule, and chat never invent coordinates. They emit a room id. The map highlights that polygon and pathfinds to its **entrance node** (hallway outside the door), not the polygon centroid.

---

## Data rules (academic, one-time extract)

Code is open source. Indoor geometry is a one-time extract from Hunter’s public Mappedin map for this capstone. Do not call that data open source.

- Save `data/hunter_campus.har` locally. **Never commit it.** HAR files often contain cookies and tokens.
- Gitignore `*.har` and `data/raw/`. Commit only normalized files (`hunter-floors.geojson`, `routing-graph.json`) plus a short source note.
- Extract **once**. The running site reads static files under `public/data/`. Do not call Mappedin (or scrape Hunter) when a student opens the app.
- **Copy the walkable graph** (nodes, neighbor edges, extra cost, accessible flags, elevator / stair / skybridge connections). That *is* Hunter’s indoor routing. Write it to `routing-graph.json`.
- **Do not copy Mappedin’s router.** No minified SDK, no `getDirections()` JavaScript, no Mappedin renderer in this repo. Academic use is not a license to vendor their engine, and that JS will not drop into MapLibre. Run our own A* with `ngraph.path` on the extracted graph.
- Reconstruct corridor centerlines from scratch only if the HAR has no nodes / connections.
- Converter must emit **WGS84** `[lon, lat]`. Prefer Mappedin’s already-georeferenced `venue.zip` `space/f_*.geojson`. Do not invent outdoor building masses from indoor Floor plates. Canvas bilinear georeference is a fallback only.

---

## Implementation schedule

### Milestone 1: 1:1 campus geometry and 3D indoor explorer (completed)

**Goal:** Match Hunter’s public map behavior in MapLibre with accurate 3D outdoor building masses, stacked indoor floorplates, visible room boundaries, and room search/selection using normalized static GeoJSON.

#### Implementation steps
1. **HAR extraction & offline geometry pipeline (`scripts/extract_har.py`, `scripts/convert_to_geojson.py`):** (Completed)
   - Extracted Mappedin raw payloads (`venue.zip`, `map.json`, `location.json`, `polygon.json`) from local network HAR archive into `data/raw/` via `scripts/extract_har.py`.
   - Extracted WGS84 outdoor and indoor geometries from `venue.zip` (`space/f_<mapId>.geojson`) and `map.json`.
   - Mapped outdoor Hunter buildings to 3D masses (`kind: mass`, height = storeys × 3.5m) and neighboring blocks to flat context (`kind: context`).
   - Normalized indoor floorplates, hallways, rooms, and walls with canonical room IDs (`canonicalRoomId`) and storey elevations (`base = (level − 1) × 3.5m`).
   - Generated 3D boundary polygon outlines (`kind: room-outline`) to provide clear visual separation between rooms.
   - Output: `apps/web/public/data/hunter-floors.geojson`.
   - Converter unit tests: `scripts/test_convert_to_geojson.py` (all passing).

2. **MapLibre 3D visualization (`MapView.tsx`):** (Completed)
   - Rendered outdoor 3D building masses with campus camera framing (pitch ~52°, bearing ~−29°).
   - Rendered elevated indoor layers (`floor-plate`, `hallways`, `rooms`, `walls`, `room-outlines`) filtered by active floor.
   - Added stacked podium extrusions (`stacked-podiums`) beneath active floors to preserve building structural context.
   - Handled Level 3 skybridge walkways connecting campus buildings.

3. **Room search and exploration UI (`CampusApp.tsx`):** (Completed)
   - Added building switcher, floor selector, and quick "All buildings" / "Outdoor" toggle.
   - Integrated room search via `parseRoomId` with autocomplete suggestions and camera fly-to.
   - Supported interactive room clicking to highlight room polygons (`#10b981`) and display room details.

### Milestone 2: Multi-building routing and skybridges (completed)

**Goal:** Campus-wide indoor pathfinding across rooms, floors, and buildings using A* on Hunter's real walkable graph.

#### Verified data findings from `venue.zip`
- `node.geojson`: 7,161 nodes with exact WGS84 `[lon, lat]` coordinates and neighbor edge weights.
- `connection.json`: 112 vertical/cross-building connectors (35 stairs, 30 elevators, 18 escalators, 29 doors).
  - East–West connector: `"East to West Building Door - Level 3 Bridge"` (the 68th St / Lexington Ave skybridge).
  - North–Thomas Hunter connector: `"North L3 to TH L2 Door"`.
- Room entrance mapping: All 2,914 named spaces in `venue.zip` have explicit `destinationNodes` connecting each room to its corridor node outside the door (no centroid guessing).

#### Implementation steps
1. **Offline graph normalization (`scripts/build_routing_graph.py`):** (Completed)
   - Extracted `node.geojson` and `connection.json` from `data/raw/venue.zip`.
   - Attached `building` (`N`, `W`, `E`, `TH`, `BTB`), `level`, and `base` elevation.
   - Built horizontal corridor links and vertical/bridge links (`stairs`, `elevator`, `escalator`, `bridge`) with `accessible` flags.
   - Mapped `canonicalRoomId` (e.g., `N304`) to entrance `nodeId`.
   - Output: `apps/web/public/data/routing-graph.json` (7,161 nodes, 112 connectors).
   - Converter tests: `scripts/test_routing_graph.py` (all passing).

2. **Client-side A* pathfinding (`apps/web/src/lib/pathfinding.ts`):** (Completed)
   - Integrated `ngraph.graph` and `ngraph.path` in `apps/web`.
   - Loaded and cached `routing-graph.json`.
   - Implemented `findRoute(fromRoomId, toRoomId, options?: { accessibleOnly?: boolean })` with 3D Euclidean heuristic, vertical transition weighting, and step-free accessibility filter.
   - Structured output into floor `legs`, `transitions`, and summary.
   - Vitest tests: `apps/web/src/lib/pathfinding.test.ts` (all passing).

3. **Route visualization in MapLibre (`MapView.tsx`):** (Completed)
   - Added 3D extruded route ribbons (`route-ribbons`) hovering slightly above floorplates with vertical gradient.
   - Added elevated start/destination pedestals and transition badges.
   - Multi-building context preserved in directions mode (`effectiveBuildingId = null`) so all campus buildings remain visible.
   - Camera smoothly auto-fits active route segments.

4. **Directions UI in `CampusApp.tsx`:** (Completed)
   - Directions panel with `Start Room` (auto-defaults to current room selection) and `Destination Room` inputs.
   - Real-time autocomplete suggestions dropdown matching room codes and names with building & floor badges.
   - Swap button (`⇅`) for reversing start and destination.
   - Accessible route toggle (`♿ Step-Free, avoid stairs & escalators`).
   - Stepper carousel controls (`← Prev` / `Next →`) with step counter and active location.
   - Turn-by-turn instruction summary for every leg and clear interactive transition cards (skybridges, elevators, stairs).
   - Clicking any step or leg automatically navigates the map to that floor and building, auto-fitting the camera.

### Milestone 3: 360° portals and class schedule (current)

1. Embed Pannellum in a modal. Attach `pano_url` on a few landmark features. Clicking those opens the lookaround viewer. Capture our own equirectangular photos (Library, Cafeteria, Skybridge) — Pannellum does not supply imagery.
2. Drag-and-drop `.ics` upload. Parse `LOCATION` with existing `parseRoomId` (`HN 304` → `N304`). Fly to the room and highlight the polygon. Pathfind to the entrance node.
3. Do **not** log into CUNYFirst.

### Milestone 4: Extended — AI campus concierge

FastAPI + Chroma with Hunter directory / FAQ text ingested **on a schedule**, not live on every question.

Example: “Where do I get a OneCard?” → short answer + room id → the same highlight and camera move as searching `N304`.

---

## Repository structure

```text
hunter-spatial/
├── apps/
│   └── web/                            # Next.js frontend (keep this app)
│       ├── public/
│       │   ├── data/
│       │   │   ├── hunter-floors.geojson   # Normalized 3D building polygons
│       │   │   └── routing-graph.json      # Hallway + skybridge node network
│       │   └── panos/                      # Our 360 photospheres
│       │       └── library.webp
│       └── src/
│           ├── components/
│           │   ├── CampusApp.tsx           # Existing shell (building / floor / search)
│           │   ├── MapView.tsx             # MapLibre 3D extruded map
│           │   ├── FloorPicker.tsx
│           │   ├── SearchBar.tsx
│           │   ├── PanoModal.tsx           # Pannellum 360 popup
│           │   └── Schedule.tsx            # .ics upload
│           └── lib/
│               ├── parseRoomId.ts          # Keep; CUNY location matcher
│               ├── pathfinding.ts          # A* via ngraph.path
│               └── icsParser.ts
├── data/
│   ├── raw/                            # Gitignored Mappedin payloads
│   └── hunter_campus.har               # Gitignored; local only
├── scripts/
│   ├── extract_har.py                  # Pull JSON responses from the HAR
│   └── convert_to_geojson.py           # venue.zip spaces → WGS84 GeoJSON
├── services/
│   └── rag-api/                        # FastAPI + Chroma (Milestone 4)
├── package.json
└── README.md
```

---

## What is already in this repo

Next.js shell, `parseRoomId` + tests, HAR extract scripts, and an early MapLibre `MapView`. Outdoor masses were incorrectly invented from indoor Floor plates (misaligned / blank floors). Milestone 1 rewrite uses `venue.zip` WGS84 spaces instead.

**Keep:** `apps/web` shell, `parseRoomId.ts` and its tests, MapLibre (no Three.js)  
**Do not commit:** `*.har`, `data/raw/`

---

## Next concrete step

1. Experimenting different software to capture equirectangular images for 360° portals.
2. Decide what places in the campus should have 360° views.
