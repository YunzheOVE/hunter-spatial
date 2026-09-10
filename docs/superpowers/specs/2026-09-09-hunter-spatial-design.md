# Hunter Spatial design spec

Date: 2026-09-09  
Scope: beta campus viewer (map layer + one scanned floor) and the data contracts later features reuse.

## Product

A website for CUNY Hunter College’s 68th Street campus.

1. Show a 3D campus (building masses from public footprints).
2. User picks a building, then a floor.
3. If that floor has a Polycam scan, load that GLB and show the real hallway.
4. If not, show a 3D floor plan extruded from the same footprint.
5. A marker sits in the hallway at the classroom door, never inside the room.

Polycam and the map are not merged into one mesh. They share the coordinate system below so a room id resolves to the same point in both views.

## Coordinate system

- Units: meters.
- Up axis: +Y (glTF / Three.js default).
- +X: east.
- +Z: north.
- Origin (local `0,0,0`): WGS84 `40.76730, -73.96550` (southwest of the Park–Lexington / 68th–69th block). Ground is `y = 0`.

Conversion from WGS84:

```
x = (lon - ORIGIN_LON) * 111320 * cos(ORIGIN_LAT)
z = (lat - ORIGIN_LAT) * 111320
```

Floor elevation for floor number `F` (1-based above ground):

```
y = (F - 1) * building.floorHeight
```

Basement / cellar floors use negative or zero indices: `C` and `EB` are `floor: 0`. Sportsplex levels B2–B4 are out of beta scope.

Door markers live at `y = floorElevation + 1.5` (eye-height in the hallway).

## Building codes

| Code | Building | Floors in beta catalog | Notes |
|------|----------|------------------------|--------|
| N | North Building | 1–16 | Prefixes `N`, `HN`, `C` (cellar → N floor 0) |
| E | East Building | 1–18 | Prefixes `E`, `HE`, `EB` (basement → E floor 0) |
| W | West Building | 1–17 | Prefixes `W`, `HW` |
| TH | Thomas Hunter Hall | 1–7 | Prefix `TH` |
| BTB | Baker Theatre Building | 1–6 | 151 East 67th Street; off the main block |

Room id grammar (Hunter “First Week” rules):

- Prefix is the longest match of `BTB`, `TH`, `EB`, `HN`, `HW`, `HE`, `N`, `E`, `W`, `C`.
- Remainder is digits plus an optional letter (`1214B`).
- `C` maps to building `N`, floor `0`.
- `EB` maps to building `E`, floor `0`.
- `HN`/`HW`/`HE` map to `N`/`W`/`E`.
- Digit body: 4+ digits → first two are floor, rest is room (`N1516` → floor 15, room 16). 3 digits → first is floor (`E618` → floor 6, room 18). 1–2 digits → floor 1, whole body is room.

## `data/campus.json`

Campus catalog. The web app loads this file; it does not scrape Hunter at runtime.

```json
{
  "version": 1,
  "coordinateSystem": {
    "units": "meters",
    "up": "Y",
    "x": "east",
    "z": "north",
    "originWgs84": { "lat": 40.7673, "lon": -73.9655 }
  },
  "campusGltf": "/models/campus.glb",
  "buildings": [
    {
      "id": "N",
      "name": "North Building",
      "floorCount": 16,
      "floorHeight": 4.52,
      "color": "#d4c4a8",
      "footprint": [[x, z], "..."],
      "center": [x, z],
      "floors": [
        {
          "level": 3,
          "scan": {
            "url": "/models/floors/N/3-scan.glb",
            "position": [x, y, z],
            "rotationY": 0,
            "scale": 1
          }
        }
      ]
    }
  ]
}
```

Rules:

- `footprint` is a closed ring in local meters `[x, z]`. The first point equals the last, or the loader closes it.
- `floors` lists only floors that have a Polycam (or placeholder) scan. Missing entries mean “floor plan only.”
- `scan.position` is the translation that aligns the scan GLB with this floor’s hallway in campus space. `rotationY` is radians around +Y. `scale` is uniform.
- Exterior campus mesh is `campusGltf`. Unscanned floors are drawn in-engine from `footprint`, not from extra GLBs.

## `data/rooms.json`

```json
{
  "version": 1,
  "rooms": [
    {
      "id": "N304",
      "buildingId": "N",
      "floor": 3,
      "label": "N304",
      "doorPosition": [x, y, z]
    }
  ]
}
```

- `id` is the canonical Hunter code after prefix normalization (`HN433` stores as `N433` if ingested that way; lookups accept both).
- `doorPosition` is in campus meters, in the hallway outside the room.
- Search / schedule / RAG later all emit this `id`. The viewer only knows how to fly to `buildingId` + `floor` + `doorPosition`.

## GLB conventions

### `assets/glb/campus.glb` (copied to `apps/web/public/models/campus.glb`)

- One scene, Y-up, meters, origin matching `campus.json`.
- Child meshes named `building-{id}` (`building-N`, `building-E`, …).
- No cameras, no lights (the app lights the scene).
- Draco optional; beta may be uncompressed triangle meshes.
- Materials: flat building colors from the catalog. Not photoreal.

### `assets/glb/floors/{buildingId}/{level}-scan.glb`

- Polycam (or beta placeholder) hallway mesh for one floor.
- Exported from Blender after aligning to the SVG/OSM skeleton.
- Origin of the file may be Polycam’s own origin; the catalog `scan.position` / `rotationY` / `scale` places it in campus space.
- Target size after decimate: under 40 MB. If a real Polycam export exceeds that, decimate in Blender before commit.
- App fetches this URL only after the user selects that building and floor.

### Blender alignment (human step for a real scan)

1. Import `campus.glb`.
2. Import Polycam GLB. Hide campus interiors; keep the matching floor plate visible.
3. Scale/rotate/move the scan until the hallway matches the floor plate.
4. Apply scale/rotation if desired, or write the leftover transform into `campus.json`.
5. Decimate, export GLB, replace `floors/N/3-scan.glb`.

## Map source (beta extract)

Hunter’s official wayfinding map is not scraped at runtime (ToS and brittleness). Beta footprints come from a one-time OpenStreetMap extract of named college buildings (NYC DoITT footprints in OSM), stored under `data/extract/`.

Interior walls on unscanned floors are schematic: a hallway along the footprint’s long axis and door markers from `rooms.json`. They are geometrically consistent with the building outline, not a trace of Hunter’s SVG. Replacing them with a facilities CAD or a licensed SVG trace is a data update, not a schema change.

Baker Theatre Building is off the main block. If OSM has no named way, the extract stores an address-geocoded rectangle and sets `source: "approximated-address"` on that building.

## Viewer behavior

- Default: orbit the whole campus, perspective camera, Y-up.
- Building select: frame that building’s `center` and show its floor list.
- Floor select: if `floors[].scan` exists, hide other buildings’ interiors, load scan GLB with a loading state, show the floor plate under it at 30% opacity only while loading. If no scan, show the extruded floor plate and hallway line.
- Marker: cone + label at `doorPosition`. Default demo room: `N304` on the scanned North floor.
- Poor devices: never preload scan GLBs. Campus GLB plus JSON only until a scanned floor is chosen.

## Out of scope for this spec (later, same IDs)

- A* on `graph.json` (nodes at doors, junctions, stairs — not mesh vertices).
- `.ics` schedule parse → room ids.
- RAG tool call `{ "roomId": "N204" }`.
- Auth, Postgres, CDN (beta serves GLBs from `/public/models`).
