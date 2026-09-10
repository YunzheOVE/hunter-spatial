# Campus extract source

Date: 2026-09-09

Hunter’s official 68th Street wayfinding map is not pulled at runtime. Beta building outlines come from a one-time OpenStreetMap dump of NYC DoITT footprints.

- Raw Overpass response: `osm-buildings-raw.json`
- Query bbox: `40.7662,-73.9668,40.7695,-73.9625`
- Named ways used: North Building, East Building, West Building, Thomas Hunter Building
- Baker Theatre Building (151 East 67th Street) was not a named OSM way in this extract; its rectangle is approximated from the street address (`source: approximated-address`)

Interior hallways on unscanned floors are generated from each footprint’s long axis. They are consistent with the building outline, not a trace of Hunter’s SVG room drawings.

To refresh footprints:

```
python scripts/extract_campus.py
python scripts/generate_glb.py
```
