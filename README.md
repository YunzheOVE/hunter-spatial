# Hunter Spatial

Indoor wayfinding for CUNY Hunter College (68th Street). Students pick a building and floor, search a room code, and see the extruded floor plan in MapLibre.

See [plan.md](plan.md) for architecture and milestones. Geometry comes from a one-time HAR extract ([data/SOURCE.md](data/SOURCE.md)).

## System Architecture: The Two-Layer Paradigm

Hunter Spatial is built around a **Two-Layer Architecture** that separates spatial vector geometry from photorealistic 360° visual inspection:

1. **Layer 1 (Spatial Map Layer — MapLibre GL JS):** An interactive, hardware-accelerated 3D vector map rendering outdoor campus towers, stacked indoor floorplates, room boundary outlines, and glowing 3D walking route ribbons.
2. **Layer 2 (Look Layer — Pannellum 360°):** On-demand photorealistic 360° interior panoramic lookarounds at landmark campus hubs (e.g., Level 3 Skybridges, Library, Cafeteria). Keeping photospheres inside an isolated modal prevents heavy image textures from causing mobile map lag.

Campus geometry and the corridor routing graph are compiled offline via Python and shipped as static files. The browser renders the map and calculates routes locally in milliseconds, with **zero backend server or database dependencies**.

```mermaid
flowchart LR
    subgraph offline["1. Offline Data Preparation"]
        direction TB
        archive["Local Hunter Map Archive<br/>(data/hunter.har)"] --> pipeline["Python Extraction Pipeline<br/>(scripts/extract_har.py, convert_to_geojson.py)"]
        pipeline --> spatialAssets["Spatial Data Assets<br/>(hunter-floors.geojson & routing-graph.json)"]
        photoAssets["360° Photospheres<br/>(panoramas/*.webp)"]
    end

    subgraph browser["2. Client Browser Application (Next.js 15 & React 19)"]
        direction TB
        user["Student"] --> ui["CampusApp UI<br/>(Search, Floor Switcher, Directions Drawer)"]
        ui --> router["In-Browser A* Router<br/>(ngraph.path)"]

        subgraph twoLayers["The Two-Layer Presentation System"]
            direction TB
            subgraph layer1["Layer 1: Spatial Map Layer (MapLibre GL JS)"]
                map["3D Extruded Campus Map<br/>• Building Masses & Stacked Floors<br/>• 3D Room Outlines & Wall Borders<br/>• Glowing 3D Navigation Route Ribbons"]
            end
            subgraph layer2["Layer 2: Look Layer (Pannellum 360°)"]
                look["Photorealistic Panoramas<br/>• Key Landmark Hubs: Skybridge, Library, Cafeteria<br/>• On-Demand Modal (Zero 3D Map GPU Lag)"]
            end
        end

        router -->|"3D route ribbon"| map
        ui -->|"Floor & room selection"| map
        ui -.->|"Open 360° hub"| look
    end

    spatialAssets -->|"Floors & room geometries"| map
    spatialAssets -->|"Corridor graph"| router
    photoAssets -->|"Photosphere textures"| look
    basemap["OpenFreeMap Basemap"] -->|"Vector tiles"| map
```

## Tech Stack

| Category | Core Technology | Role in Hunter Spatial |
|:---|:---|:---|
| **Web & UI** | Next.js 15, React 19, TypeScript 5, Tailwind CSS v4 | Application shell, reactive floor state, search autocomplete, responsive drawers |
| **3D Geospatial** | MapLibre GL JS v6 (WebGL2), OpenFreeMap | GPU-accelerated 3D campus masses, extruded indoor room plans, and route ribbons |
| **Routing Engine** | `ngraph.graph`, `ngraph.path` (A* Algorithm) | Sub-3ms in-browser 3D shortest pathfinding, multi-floor routing, and ADA filter |
| **Data Pipeline** | Python 3, GeoJSON (WGS84) | Offline HAR extraction, geometry cleanup, 3D room boundaries, and graph generation |
| **Testing Suite** | Vitest, Python `unittest` | Unit and integration testing across frontend logic and geospatial pipelines |

> 📖 **Full Architectural Reference:** See [**stack.md**](stack.md) for in-depth descriptions of each tool, algorithm details, data formats, and design decisions (such as MapLibre GL JS vs. Three.js).

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

- [plan.md](plan.md) — stages, milestones, and data rules
- [stack.md](stack.md) — full technical stack, algorithms, data formats, and testing reference
- `apps/web` — the Next.js web application
- `scripts/` — data extraction, geometry conversion, and routing graph scripts
- `data/` — local HAR only (gitignored); do not commit `.har` or `data/raw/`
