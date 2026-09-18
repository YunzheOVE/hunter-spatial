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
- Converter must emit **WGS84** `[lon, lat]`. Use Mappedin’s lat/lng when present; otherwise apply the venue transform. Until that works, the building renders in the ocean or as a smear.

---

## Implementation schedule

### Milestone 1: Beta — HAR ingest and 3D floor (now)

1. Inspect the HAR. Do not assume the payloads are already GeoJSON. The known blobs (`geometry.json` ~719 kB, `locations.json` ~32.6 kB) may be an older Mappedin venue format, not an MVF zip. Also look for extra node / connection requests.
2. `scripts/extract_har.py` writes those JSON bodies to `data/raw/` (gitignored).
3. `scripts/convert_to_geojson.py` normalizes to WGS84 FeatureCollections with properties `level`, `building`, `roomId`, `kind` (`room` / `hallway` / `wall`).
4. Mount `maplibre-gl` in `apps/web/src/components/MapView.tsx` (client-only dynamic import; MapLibre needs `window`).
5. `fill-extrusion` for walls / rooms (height ~3 m, or Mappedin floor elevation if present).
6. Floor picker filters with `['==', ['get', 'level'], activeFloor]`.
7. Click a room polygon to highlight it. Search still goes through `parseRoomId`.

**Done when:** A student opens the web app, sees the real 3D floor plan of Hunter North floor 3 and Hunter West floor 3, and can click room polygons.

### Milestone 2: Multi-building routing and skybridges

1. Parse corridor nodes and vertical connectors into `public/data/routing-graph.json`. Prefer the graph already in the HAR.
2. Cross-building links: connect Hunter West and Hunter North on level 3 via the 68th Street / Lexington Avenue skybridge **if that connection is in the data**. Do not invent a link the extract does not support.
3. Client-side A* (`ngraph.path`) between room **entrance nodes**. Draw the route as a line layer on the current floor.

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
│   └── convert_to_geojson.py           # Mappedin blobs → WGS84 GeoJSON + graph
├── services/
│   └── rag-api/                        # FastAPI + Chroma (Milestone 4)
├── package.json
└── README.md
```

---

## What is already in this repo

The Next.js shell (building / floor / room search via `parseRoomId`). No indoor geometry yet — the map pane is empty until Milestone 1 GeoJSON exists.

**Keep:** `apps/web` shell, `parseRoomId.ts` and its tests  
**Do not commit:** `*.har`, `data/raw/`

---

## Next concrete step

1. Save Hunter’s map network archive locally as `data/hunter_campus.har` (gitignored).
2. Inspect payload schemas; write `extract_har.py` and `convert_to_geojson.py`.
3. Render North 3 and West 3 in MapLibre and confirm room clicks + `parseRoomId` search still work.
