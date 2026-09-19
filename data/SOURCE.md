# Indoor geometry source

One-time extract from Hunter College’s public [68th Street Mappedin map](https://www.hunter.cuny.edu/about/campus-information/68th-street-campus/map/), captured locally as `data/hunter.har` (gitignored).

Raw payloads (gitignored): `data/raw/map.json`, `polygon.json`, `location.json`, and **`venue.zip`**.

**Primary geometry for Milestone 1:** `venue.zip` → `space/f_<mapId>.geojson` (already WGS84). Outdoor named footprints are the outdoor building model; indoor space files are the floor layouts. Do not invent outdoor masses from indoor Floor plates.

Normalized output for the app: `apps/web/public/data/hunter-floors.geojson`.

```bash
python scripts/extract_har.py
python scripts/convert_to_geojson.py
```

Code and MapLibre are open source. This indoor geometry is not, do not call Mappedin from the running site.
