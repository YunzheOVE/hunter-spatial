#!/usr/bin/env python3
"""Build campus markers GeoJSON containing labeled points for all rooms,

staircases, elevators, and washrooms with appropriate icons and 3D elevations.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
import zipfile

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT_DIR / "scripts"))
from convert_to_geojson import load_spaces, _group_buildings, parse_level

FLOORS_GEOJSON = ROOT_DIR / "apps" / "web" / "public" / "data" / "hunter-floors.geojson"
RAW_DIR = ROOT_DIR / "data" / "raw"
VENUE_ZIP = RAW_DIR / "venue.zip"
MAP_JSON = RAW_DIR / "map.json"
OUTPUT_FILE = ROOT_DIR / "apps" / "web" / "public" / "data" / "campus-markers.geojson"

STOREY_HEIGHT = 3.5


def polygon_centroid(coords: list) -> list[float]:
    """Calculate the centroid of a polygon coordinate ring."""
    # Walk down to the first coordinate ring
    ring = coords
    while ring and isinstance(ring[0], list) and isinstance(ring[0][0], list):
        ring = ring[0]

    if not ring or not isinstance(ring[0], list):
        return [-73.9646, 40.7685]

    # Average of vertices
    pts = [p for p in ring if len(p) >= 2]
    if not pts:
        return [-73.9646, 40.7685]
    avg_lon = sum(p[0] for p in pts) / len(pts)
    avg_lat = sum(p[1] for p in pts) / len(pts)
    return [round(avg_lon, 7), round(avg_lat, 7)]


def categorize_room(name: str, room_id: str) -> dict:
    """Return dictionary of category metadata for a room."""
    n_lower = name.lower()

    if "women's washroom" in n_lower or "female" in n_lower or "women" in n_lower:
        return {
            "category": "restroom_women",
            "iconBadge": "badge-restroom-women",
            "displayCode": "",
            "icon": "🚺",
            "label": "🚺 Women's",
        }
    if "men's washroom" in n_lower or "male" in n_lower or "men" in n_lower:
        return {
            "category": "restroom_men",
            "iconBadge": "badge-restroom-men",
            "displayCode": "",
            "icon": "🚹",
            "label": "🚹 Men's",
        }
    if "washroom" in n_lower or "restroom" in n_lower or "toilet" in n_lower:
        return {
            "category": "restroom",
            "iconBadge": "badge-restroom",
            "displayCode": "",
            "icon": "🚻",
            "label": "🚻 Restroom",
        }
    if "stair" in n_lower:
        return {
            "category": "stairs",
            "iconBadge": "badge-stairs",
            "displayCode": "",
            "icon": "🪜",
            "label": f"🪜 {name}",
        }
    if "elevator" in n_lower:
        return {
            "category": "elevator",
            "iconBadge": "badge-elevator",
            "displayCode": "",
            "icon": "🛗",
            "label": f"🛗 {name}",
        }
    if "escalator" in n_lower:
        return {
            "category": "escalator",
            "iconBadge": "badge-stairs",
            "displayCode": "",
            "icon": "⚡",
            "label": f"⚡ {name}",
        }
    if "library" in n_lower:
        return {
            "category": "library",
            "iconBadge": "badge-study",
            "displayCode": name if len(name) <= 16 else "Library",
            "icon": "📖",
            "label": f"📖 {name}",
        }
    if "study" in n_lower or "lounge" in n_lower or "veteran" in n_lower or "services" in n_lower:
        short = name if len(name) <= 24 else name[:22] + "…"
        return {
            "category": "study",
            "iconBadge": "badge-study",
            "displayCode": short,
            "icon": "📚",
            "label": f"📚 {name}",
        }
    if "cafeteria" in n_lower or "cafe" in n_lower or "dining" in n_lower or "food" in n_lower:
        short = name if len(name) <= 18 else name[:16] + "…"
        return {
            "category": "food",
            "iconBadge": "badge-food",
            "displayCode": short,
            "icon": "☕",
            "label": f"☕ {name}",
        }
    if "theatre" in n_lower or "theater" in n_lower or "auditorium" in n_lower or "lecture" in n_lower:
        short = name if len(name) <= 20 else name[:18] + "…"
        return {
            "category": "lecture",
            "iconBadge": "badge-lecture",
            "displayCode": short,
            "icon": "🎭",
            "label": f"🎭 {name}",
        }
    if "office" in n_lower or "admissions" in n_lower or "center" in n_lower or "help desk" in n_lower:
        clean_code = room_id if room_id and any(c.isdigit() for c in room_id) else (name if len(name) <= 18 else name[:16] + "…")
        return {
            "category": "office",
            "iconBadge": "badge-office",
            "displayCode": clean_code,
            "icon": "🏢",
            "label": f"🏢 {clean_code}",
        }
    if "lab" in n_lower:
        clean_code = room_id if room_id and any(c.isdigit() for c in room_id) else (name if len(name) <= 18 else name[:16] + "…")
        return {
            "category": "lab",
            "iconBadge": "badge-classroom",
            "displayCode": clean_code,
            "icon": "🔬",
            "label": f"🔬 {clean_code}",
        }

    # Standard classroom or room identifier (e.g. W305, 11007, HN-304, N121A)
    clean_code = room_id if room_id and any(c.isdigit() for c in room_id) else name.strip()
    return {
        "category": "classroom",
        "iconBadge": "badge-classroom",
        "displayCode": clean_code,
        "icon": "🎓",
        "label": f"🎓 {clean_code}",
    }


def build_markers() -> dict:
    floors_data = json.loads(FLOORS_GEOJSON.read_text(encoding="utf-8"))
    maps_data = json.loads(MAP_JSON.read_text(encoding="utf-8"))
    spaces_by_map = load_spaces(VENUE_ZIP, maps_data)
    group_buildings = _group_buildings(maps_data, spaces_by_map)

    map_lookup: dict[str, dict] = {}
    for m in maps_data:
        m_id = str(m.get("id") or "").removeprefix("f_")
        level = parse_level(
            m.get("name") or "",
            m.get("shortName") or "",
            m.get("elevation"),
        )
        building = group_buildings.get(m.get("group") or "", "")
        map_lookup[m_id] = {"level": level, "building": building}

    markers: list[dict] = []
    seen_marker_keys: set[tuple[str, int, float, float]] = set()

    # 1. Process all room polygons
    for feature in floors_data.get("features", []):
        props = feature.get("properties") or {}
        if props.get("kind") != "room":
            continue

        name = str(props.get("name") or props.get("roomId") or "")
        room_id = str(props.get("roomId") or name)
        if not name or name == "None":
            continue

        level = props.get("level")
        if level is None:
            continue
        level = int(level)

        building = str(props.get("building") or "")
        base = float(props.get("base") or max(0.0, (level - 1) * STOREY_HEIGHT))

        centroid = polygon_centroid(feature.get("geometry", {}).get("coordinates", []))
        key = (building, level, round(centroid[0], 5), round(centroid[1], 5))
        if key in seen_marker_keys:
            continue
        seen_marker_keys.add(key)

        cat_meta = categorize_room(name, room_id)

        markers.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": centroid},
                "properties": {
                    "id": f"marker-{props.get('id', room_id)}",
                    "kind": "room",
                    "category": cat_meta["category"],
                    "iconBadge": cat_meta["iconBadge"],
                    "displayCode": cat_meta["displayCode"],
                    "icon": cat_meta["icon"],
                    "label": cat_meta["label"],
                    "name": name,
                    "roomId": room_id,
                    "building": building,
                    "level": level,
                    "base": round(base, 2),
                    "height": round(base + 0.5, 2),
                },
            }
        )

    # 2. Extract vertical transit (stairs, elevators, escalators) from connection.json
    with zipfile.ZipFile(VENUE_ZIP) as z:
        conns = json.loads(z.read("connection.json").decode("utf-8"))
        nodes_geo = json.loads(z.read("node.geojson").decode("utf-8"))

        nodes: dict[str, dict] = {}
        for f in nodes_geo.get("features", []):
            n_props = f.get("properties") or {}
            n_id = n_props.get("id")
            raw_map_id = str(n_props.get("map") or "").removeprefix("f_")
            map_info = map_lookup.get(raw_map_id, {"level": 1, "building": ""})
            if n_id:
                nodes[n_id] = {
                    "coordinates": f.get("geometry", {}).get("coordinates"),
                    "level": map_info["level"],
                    "building": map_info["building"],
                }

        for c in conns:
            c_type = c.get("type")
            if c_type not in {"stairs", "elevator", "escalator"}:
                continue

            raw_name = (c.get("details") or {}).get("name") or c.get("name") or c_type
            clean_name = raw_name.replace("Building", "").strip()

            icon = "🪜" if c_type == "stairs" else "🛗" if c_type == "elevator" else "⚡"
            icon_badge = "badge-stairs" if c_type in {"stairs", "escalator"} else "badge-elevator"
            label_prefix = icon

            for n_id in c.get("nodes", []):
                if n_id not in nodes:
                    continue
                node = nodes[n_id]
                coords = node["coordinates"]
                level = node["level"]
                building = node["building"]

                key = (building, level, round(coords[0], 5), round(coords[1], 5))
                if key in seen_marker_keys:
                    continue
                seen_marker_keys.add(key)

                base = max(0.0, (level - 1) * STOREY_HEIGHT)
                markers.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": coords},
                        "properties": {
                            "id": f"marker-transit-{n_id}",
                            "kind": c_type,
                            "category": c_type,
                            "iconBadge": icon_badge,
                            "displayCode": "",
                            "icon": icon,
                            "label": f"{label_prefix} {clean_name}",
                            "name": clean_name,
                            "roomId": clean_name,
                            "building": building,
                            "level": level,
                            "base": round(base, 2),
                            "height": round(base + 0.5, 2),
                        },
                    }
                )

    print(f"Generated {len(markers)} campus markers.")
    return {"type": "FeatureCollection", "features": markers}


def main():
    data = build_markers()
    OUTPUT_FILE.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {OUTPUT_FILE} ({len(OUTPUT_FILE.read_bytes()) // 1024} KB)")


if __name__ == "__main__":
    main()
