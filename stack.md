# Technology Stack & Architecture Reference

This document provides a comprehensive, structured reference of all technologies, engines, algorithms, data formats, and testing tools utilized across **Hunter Spatial**.

---

## 1. Core Web Tech Stack

### Next.js 15 (App Router)
* **What it is:** A production React framework for modern web applications.
* **What it does in the project:** Serves as the web application backbone. It handles fast client-side routing, automatic code-splitting (lazy-loading the heavy 3D map only when needed), and compiles production bundles.

### React 19
* **What it is:** A component-based JavaScript UI library by Meta.
* **What it does in the project:** Powers the interactive user interface. It reactively manages state—such as switching the active floor, updating selected rooms, populating autocomplete suggestions, and advancing direction steps.

### Node.js
* **What it is:** A local runtime environment that executes JavaScript outside of the browser.
* **What it does in the project:** Used strictly during development as the build and tooling environment (installing packages via `npm`, running compilers, and running dev servers). It is not a live backend server.

### TypeScript 5
* **What it is:** A statically typed superset of JavaScript.
* **What it does in the project:** Enforces strict type contracts across all spatial geometries, routing leg objects, and component props, catching errors at compile time before running the app.

### Tailwind CSS v4
* **What it is:** A utility-first CSS styling framework.
* **What it does in the project:** Provides all visual styling and responsive layouts (the floating control panel, mobile bottom drawer, step-by-step navigation cards, and custom amenity badges).

---

## 2. 3D Geospatial Engine & Visualization

### MapLibre GL JS v6
* **What it is:** An open-source, hardware-accelerated WebGL geospatial mapping engine.
* **What it does in the project:** Renders the 3D map canvas. It natively handles camera pitch (tilt), bearing (rotation), smooth zooming, outdoor 3D building towers (`hunter-mass`), elevated indoor floorplates, 3D room boundary borders, and glowing 3D navigation route ribbons.

### WebGL2
* **What it is:** The browser's native GPU graphics API.
* **What it does in the project:** MapLibre uses WebGL2 under the hood to perform hardware-accelerated 3D polygon extrusions (`fill-extrusion`) at 60 FPS with real-time depth buffering.

### OpenFreeMap (Positron Basemap Tiles)
* **What it is:** A free, open-source vector tile service based on OpenStreetMap.
* **What it does in the project:** Draws the clean, muted street grid and surrounding city blocks of Manhattan around Hunter College.

### Why MapLibre GL JS instead of Three.js?
* **Three.js** is a general-purpose 3D graphics/game engine. It does not natively understand geographic GPS coordinates (latitude/longitude), has no built-in map camera or GIS projection controls, and requires loading heavy 3D model files (`.obj`/`.gltf`) that cause massive downloads and mobile lag.
* **MapLibre GL JS** is built specifically for geospatial maps. It renders lightweight vector polygons (GeoJSON) directly into 3D using the GPU, keeping our entire campus payload under 1 MB and running at 60 FPS on mobile devices.

---

## 3. Routing & Algorithms

### ngraph.graph
* **What it is:** A high-performance, lightweight graph data structure library for JavaScript.
* **What it does in the project:** Constructs and holds the in-memory directed graph of Hunter's physical corridor network (7,161 walkable nodes and 112 multi-floor connectors).

### ngraph.path (A* Pathfinding Algorithm)
* **What it is:** An in-browser shortest-path graph solver implementing the A* (A-Star) algorithm.
* **What it does in the project:** Calculates the optimal walking path between any two rooms in ~3 milliseconds directly inside the user's browser—with zero server roundtrips.

### 3D Euclidean Distance Heuristic
* **What it is:** A custom spatial distance equation used by A* to estimate remaining distance.
* **What it does in the project:** Evaluates longitude, latitude, and vertical floor height ($3.5\text{m}$ per storey). It applies vertical transition penalties to discourage unnecessary floor changes, ensuring routes prefer walking along the current floor before taking stairs or elevators.

### Step-Free Wheelchair Accessibility Filter
* **What it is:** A graph-filtering constraint applied before running A*.
* **What it does in the project:** When enabled, it prunes all stairs and escalator edges from the graph, restricting pathfinding exclusively to ADA-compliant elevators, ramps, and flat Level 3 skybridges.

### Doorway Entrance Mapping (destinationNodes)
* **What it is:** Architectural door threshold binding.
* **What it does in the project:** Instead of guessing room centers (centroids) which leads to paths cutting through walls, each room code is anchored to the exact corridor waypoint positioned outside its entrance door.

---

## 4. Data Formats & Offline Data Pipeline

### WGS84 (EPSG:4326)
* **What it is:** The universal GPS coordinate standard (standard latitude and longitude used by satellites).
* **What it does in the project:** Serves as the universal coordinate system for all building footprints, room polygons, and transit nodes, ensuring sub-meter alignment with the real world.

### GeoJSON (RFC 7946)
* **What it is:** The open standard JSON specification for geographic features.
* **What it does in the project:** The data format for our compiled assets (`hunter-floors.geojson`, `campus-markers.geojson`). Stores coordinates, elevations, room IDs, and display colors.

### HAR (HTTP Archive)
* **What it is:** A standardized JSON capture of browser network requests.
* **What it does in the project:** Used for the initial one-time extraction of Hunter’s raw public venue package without needing a runtime scraping server.

### Python 3 Data Extraction Scripts (`scripts/`)
* **`extract_har.py`:** Parses the raw network HAR archive and extracts `venue.zip`, `map.json`, `location.json`, and `polygon.json`.
* **`convert_to_geojson.py`:** Converts raw CAD polygons into standardized GeoJSON (`hunter-floors.geojson`), calculates storey heights, and generates 3D room boundary quads (`build_room_outlines`).
* **`build_routing_graph.py`:** Compiles the 7,161 nodes, doorway connections, and vertical transit edges into `routing-graph.json`.
* **`build_campus_markers.py`:** Generates point markers for classrooms, elevators, stairs, and restrooms with custom badges.

---

## 5. Testing & Quality Assurance

### Vitest
* **What it is:** A next-generation, Vite-powered TypeScript unit testing framework.
* **What it does in the project:** Runs automated tests for frontend logic—verifying room code parsing (`parseRoomId`), A* pathfinding, accessibility routing, and ribbon geometry generation (23/23 tests passing).

### Python unittest
* **What it is:** Python’s built-in unit testing framework.
* **What it does in the project:** Tests data pipeline scripts—verifying elevation calculations, no orphan routing nodes, and clean GeoJSON exports (15/15 tests passing).

### ESLint & TypeScript Compiler (`tsc --noEmit`)
* **What it is:** Static code analysis and linting tools.
* **What it does in the project:** Enforces code quality, prevents syntax bugs, and guarantees 100% strict type safety across all files.
