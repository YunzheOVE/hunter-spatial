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
| **Look** | Pannellum modal with runtime panorama metadata | User submissions and reviewer approval; development fixture available |
| **Panorama storage** | Next.js Node routes + SQLite + local image files | Map geometry stays static; images are served at runtime |
| **Pathfinding** | `ngraph.path` (A*) on an extracted walkable graph | We copy the graph, not Mappedin’s JavaScript |
| **Schedule** | Client-side `.ics` parse + existing `parseRoomId` | No CUNYFirst login |
| **Assistant (later)** | FastAPI + Chroma RAG | Returns a room id the map already knows |

Keep the Next.js app shell ([`apps/web/src/components/CampusApp.tsx`](apps/web/src/components/CampusApp.tsx)), [`parseRoomId.ts`](apps/web/src/lib/parseRoomId.ts), and Vitest tests. Add a MapLibre `MapView` in Milestone 1. Do not bring Three.js back.

---

## Two layers (do not mix them)

| Layer | What it is | How it is implemented |
|--------|------------|------------------------|
| **Map** | Building perimeters, floors, walls, hallways, room polygons, path lines | Extracted GeoJSON rendered with MapLibre (`fill-extrusion`) |
| **Look** | Approved user-submitted interiors tied to existing location IDs | Image files and coverage settings loaded into a Pannellum modal |

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

See [Panorama upload system plan](docs/panorama-upload-plan.md) for the detailed
design, database layout, and five-phase progression of the upload system.

1. **Phase 1 (implemented):** Pannellum modal from room details, full/partial coverage, close button and Escape. Closing preserves map state.
2. **Phase 2 (implemented):** SQLite `users` and `panoramas` tables, separate local image storage, approved metadata/image endpoints, and explicit N304 development seed. See [database/README.md](database/README.md).
3. **Phase 3 (implemented):** Simple sign-up, sign-in, sign-out, and user uploads (details below).
4. **Phase 4:** Reviewer preview and one-time approval/rejection; latest approval becomes the displayed panorama.
5. **Phase 5:** Runtime approved-image badges/filter, end-to-end polish, and documentation.

Class schedules remain separate future work: parse uploaded `.ics` `LOCATION`
with `parseRoomId`, highlight the room, and route to its entrance. No CUNYFirst login.

#### Phase 3 — Simple accounts and submissions

- **Accounts:** Name, email, and password sign-up; email/password sign-in; sign-out. Require the exact `@login.cuny.edu` domain for sign-up and sign-in, ignoring capitalization. Every public sign-up is an uploader; permissions come from the stored role. No JWT, SSO, email ownership verification, password reset, or reviewer self-registration in this local MVP.
- **Precreated reviewer:** `npm run db:seed` creates `reviewer@login.cuny.edu` with initial demo password `ReviewerDemo2026!`, documented in [database/README.md](database/README.md#reviewer-demo-account) and linked from the main README. Reserve that address from sign-up. Create the account if absent; repeated setup preserves its password. Report a conflict if the reserved address belongs to an uploader. Both roles use the same sign-in form; approval controls remain Phase 4. No legacy account conversion or migration support.
- **Password storage:** One-way salted scrypt hashes using Node's built-in crypto module. Never store plaintext or reversible passwords.
- **Input limits:** Name required, maximum 50 characters; email required, maximum 100 characters; password 8–100 characters. Enforce on both frontend and backend.
- **Sessions:** A random opaque session ID in an HTTP-only, SameSite=Lax cookie; its hash, user ID, and 24-hour expiry live in a SQLite `sessions` table. Sign-out deletes the server record and clears the cookie.
- **Upload tab:** Required searchable location dropdown reusing the existing routing-graph list. Preselect a room when launched from room details. Accept readable, non-animated JPEG/PNG/WebP up to 20 MB and 64 megapixels; preserve original bytes with generated filenames. Support full/partial coverage and a preview modal.
- **Submission records:** Validate location, image, and coverage on the backend. Use the authenticated user's ID, always start as pending, and remove the saved file if insertion fails. Show My submissions with status and private previews; only the owner and reviewers may access unpublished images.
- **Checkpoint:** Sign up → select location → preview → submit → see pending status; sign out/in and restart without losing records. Approved-image selection remains unchanged. Reviewer decisions and runtime map badges/filtering remain Phases 4 and 5.

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

1. Add reviewer preview and one-time approval/rejection decisions in Phase 4.
2. Connect runtime panorama badges and filtering in Phase 5.
