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

### Milestone 1: Beta — 1:1 campus geometry from HAR (now)

**Goal:** Match Hunter’s public map behavior in MapLibre — not a Mappedin SDK twin. Outdoor Hunter buildings are accurate 3D masses; neighbors stay flat gray; each selected floor is a detailed room layer at that floor’s real height.

**Approach:** Venue-zip first. Rebuild normalization around `data/raw/venue.zip` (`space/f_<mapId>.geojson`), which is already WGS84. Use `map.json` only for mapId → outdoor/indoor, level, and building group. Keep `polygon.json` only if walls/hallways are missing from the zip spaces.

#### Data pipeline

1. `scripts/extract_har.py` writes `polygon.json`, `location.json`, `map.json`, and `venue.zip` to `data/raw/` (gitignored).
2. Rewrite `scripts/convert_to_geojson.py` to read `venue.zip`:
   - **Outdoor map:** features named North / West / East / Thomas Hunter Hall / Baker Theatre → `kind: mass` with `height = storeys × 3.5`. Other outdoor polygons → `kind: context` (flat neighbors) or `bridge`.
   - **Indoor maps:** named spaces → `kind: room` + `roomId`; unnamed walkable spaces → `hallway`. Attach `level`, `building`, `base = (level − 1) × 3.5`, and short extrusion `height`.
   - Optionally merge wall outlines from `polygon.json` if the zip lacks edges.
3. Emit one FeatureCollection to `apps/web/public/data/hunter-floors.geojson` with properties: `kind`, `building`, `level`, `roomId`, `base`, `height`, `scope` (`campus` | `indoor`).

#### MapView (MapLibre only)

4. Keep client-only `MapView` (dynamic import). Light basemap; hide basemap 3D buildings.
5. **Outdoor (default):** flat gray `context`; purple `mass` fill-extrusions for the five Hunter buildings; fit campus camera (pitch ~50°, bearing ~−29°).
6. **Floor selected:** shorten masses to a gray podium `height = max(0, (floor − 1) × 3.5)`; draw that floor’s rooms/hallways with `fill-extrusion-base = (floor − 1) × 3.5`; add a **dark line layer** on room polygons so walls are visible (no solid blank slab).
7. Floor picker filters indoor layers with `['==', ['get', 'level'], activeFloor]`. Outdoor masses stay on screen.
8. Click room / search via `parseRoomId` + `canonicalRoomId` highlights the room (gold) without hiding the rest of campus.

#### Out of Milestone 1

Routing graph, Directions UI, smart labels/icons, Pannellum, `.ics`, RAG.

**Done when (Chrome):**

1. Outdoor: five Hunter towers match the 68th Street block footprints; neighbors are flat gray; no invented overhanging masses.
2. Floor 3: visible room outlines; North/West plans sit on a short podium; `N304` is clickable and searchable.
3. Floors 7 and 15 sit clearly higher than floor 3 (same building stack, not glued to ground).
4. Indoor layouts stay inside their building mass.
5. Static `public/data/` only — no Mappedin at runtime.

**Tests:** converter tests (named outdoor → mass; `N304` present; `base`/`height` math); existing `parseRoomId` Vitest; manual Chrome checklist above.

### Milestone 2: Multi-building routing and skybridges

**Goal:** Campus-wide indoor pathfinding across rooms, floors, and buildings using A* on Hunter's real walkable graph.

#### Verified data findings from `venue.zip`
- `node.geojson`: 7,161 nodes with exact WGS84 `[lon, lat]` coordinates and neighbor edge weights.
- `connection.json`: 112 vertical/cross-building connectors (35 stairs, 30 elevators, 18 escalators, 29 doors).
  - East–West connector: `"East to West Building Door - Level 3 Bridge"` (the 68th St / Lexington Ave skybridge).
  - North–Thomas Hunter connector: `"North L3 to TH L2 Door"`.
- Room entrance mapping: All 2,914 named spaces in `venue.zip` have explicit `destinationNodes` connecting each room to its corridor node outside the door (no centroid guessing).

#### Implementation steps
1. **Offline graph normalization (`scripts/build_routing_graph.py`):**
   - Extract `node.geojson` and `connection.json` from `data/raw/venue.zip`.
   - Cross-reference `map.json` to attach `building` (`N`, `W`, `E`, `TH`, `BTB`), `level`, and `base` elevation.
   - Build horizontal corridor links and vertical/bridge links (`stairs`, `elevator`, `escalator`, `bridge`) with `accessible` flags.
   - Map `canonicalRoomId` (e.g., `N304`) to entrance `nodeId`.
   - Output: `apps/web/public/data/routing-graph.json`.
   - Add converter tests: `scripts/test_routing_graph.py`.

2. **Client-side A* pathfinding (`apps/web/src/lib/pathfinding.ts`):**
   - Install `ngraph.graph` and `ngraph.path` in `apps/web`.
   - Load and cache `routing-graph.json`.
   - Implement `findRoute(fromRoomId, toRoomId, options?: { accessibleOnly?: boolean })`:
     - Resolve entrance nodes, execute A* with 3D Euclidean heuristic and vertical transition weighting.
     - Structure output into floor `legs` (`building`, `level`, coordinates `[lon, lat][]`), `transitions` (stairs/elevator/bridge), and estimated distance/time.
   - Add Vitest tests in `apps/web/src/lib/pathfinding.test.ts`.

3. **Route visualization in MapLibre (`MapView.tsx`):**
   - Add GeoJSON source and line layer (`route-line`) styled above hallways and rooms.
   - Render the route leg corresponding to the currently selected `floor` and `building`.
   - Add start/destination pins and transition markers (stair/elevator/bridge icons) at floor handoffs.
   - Camera auto-fits the active route segment.

4. **Directions UI in `CampusApp.tsx`:**
   - Directions panel with `Start Room` (defaults to current selection) and `Destination Room` inputs.
   - Accessible route toggle (avoids stairs/escalators).
   - Turn-by-turn / leg summary (e.g., "Walk corridor on Level 3" → "Cross Level 3 Skybridge to West" → "Take Elevator to Level 5").
   - Clicking any step or leg automatically navigates the map to that floor and building.

### Milestone 3: 360° portals and class schedule

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

1. Rewrite `convert_to_geojson.py` to use `venue.zip` `space/f_*.geojson` for outdoor masses and indoor rooms.
2. Update `MapView` for outdoor masses + elevated floor layers with visible room outlines.
3. Verify Outdoor, floor 3 (`N304`), floor 7, and floor 15 in Chrome against Hunter’s map.
