"""Normalize Mappedin venue spaces to static WGS84 GeoJSON for MapLibre."""

from __future__ import annotations

import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
OUT_PATH = ROOT / "apps" / "web" / "public" / "data" / "hunter-floors.geojson"

STOREY_M = 3.5
FLOOR_HEIGHT_M = 0.04
HALLWAY_HEIGHT_M = 0.08
ROOM_HEIGHT_M = 0.22
WALL_HEIGHT_M = 0.7
BRIDGE_BASE_M = 2 * STOREY_M
BRIDGE_HEIGHT_M = BRIDGE_BASE_M + 2.6

BUILDINGS = {
    "North Building": ("N", 16),
    "West Building": ("W", 18),
    "East Building": ("E", 18),
    "Thomas Hunter Hall": ("TH", 7),
    "Baker Theatre": ("BTB", 6),
}

PREFIXES = (
    ("BTB", "BTB"),
    ("TH", "TH"),
    ("WB", "W"),
    ("EB", "EB"),
    ("HN", "N"),
    ("HW", "W"),
    ("HE", "E"),
    ("N", "N"),
    ("W", "W"),
    ("E", "E"),
    ("C", "C"),
)

# West Levels 1-4 contain the same isolated service pillar mislabeled as
# walkable floor, hallway, and wall geometry.
IGNORED_PILLAR_IDS = {
    "683562a3db380b0b722f00e5",
    "68365ef5db380b0b722f04c1",
    "68393fc198567c2957c39a83",
    "68357b47db380b0b722f0124",
    "68365f53db380b0b722f04d2",
    "68357c4bdb380b0b722f01d0",
    "684265bea08e5c2219058ac8",
    "68365f78db380b0b722f04db",
    "683e7f154b67ba0b19e90924",
    "68357bb2db380b0b722f018b",
    "68365f95db380b0b722f04e7",
    "68357d1fdb380b0b722f01d6",
}


def parse_level(name: str, short_name: str = "", elevation: int | float | None = None) -> int:
    text = f"{name} {short_name}".strip()
    lower = text.lower()
    if "concourse" in lower:
        return 0
    if "ground" in lower:
        return 0 if elevation == -1 else 1
    if "basement" in lower or re.search(r"\bB\d+\b", text):
        nums = re.findall(r"\d+", text)
        return -int(nums[0]) if nums else 0
    level_match = re.search(r"(?:level|l)\s*(\d+)", lower)
    if level_match:
        return int(level_match.group(1))
    return int(elevation) + 1 if elevation is not None else 1


def canonical_room_id(name: str, external_id: str = "") -> str:
    """Return a searchable Hunter room code, or the display name for landmarks."""
    for value in (name, external_id):
        text = (value or "").strip().upper()
        for prefix, building in PREFIXES:
            match = re.match(rf"^{prefix}[\s-]*([0-9][0-9A-Z-]*)", text)
            if not match:
                continue
            room = match.group(1).replace("-", "")
            if room.startswith(building) and len(room) > len(building) and room[len(building)].isdigit():
                room = room[len(building) :]
            return f"{building}{room}"
    return name.strip()


def _feature_name(feature: dict) -> str:
    return ((feature.get("properties") or {}).get("details") or {}).get("name", "").strip()


def _feature_id(feature: dict) -> str:
    props = feature.get("properties") or {}
    return str(props.get("id") or feature.get("id") or "")


def _raw_id(feature: dict) -> str:
    return _feature_id(feature).removeprefix("s_")


def _group_buildings(maps: list[dict], spaces_by_map: dict[str, list[dict]]) -> dict[str, str]:
    votes: dict[str, Counter[str]] = defaultdict(Counter)
    for mapped_map in maps:
        group = mapped_map.get("group")
        if not group:
            continue
        for feature in spaces_by_map.get(mapped_map["id"], []):
            room_id = canonical_room_id(_feature_name(feature))
            for prefix, building in (("BTB", "BTB"), ("TH", "TH"), ("EB", "E"), ("C", "N"), ("N", "N"), ("W", "W"), ("E", "E")):
                if room_id.startswith(prefix) and room_id[len(prefix) : len(prefix) + 1].isdigit():
                    votes[group][building] += 1
                    break
    return {group: counts.most_common(1)[0][0] for group, counts in votes.items() if counts}


import math

def load_styles(venue_path: Path) -> dict[str, str]:
    poly_to_color: dict[str, str] = {}
    if not venue_path.exists():
        return poly_to_color
    with zipfile.ZipFile(venue_path) as venue:
        if "styles.json" in venue.namelist():
            styles = json.loads(venue.read("styles.json").decode("utf-8"))
            for sval in styles.values():
                c = sval.get("color")
                if not c:
                    continue
                for p in sval.get("polygons", []):
                    poly_to_color[p] = c
                    if p.startswith("s_"):
                        poly_to_color[p[2:]] = c
    return poly_to_color


def build_room_outlines(room_features: list[dict], width_m: float = 0.02) -> list[dict]:
    cos_lat = math.cos(math.radians(40.7685))
    m_per_deg_lat = 111139.0
    m_per_deg_lon = m_per_deg_lat * cos_lat
    half_w = width_m / 2.0

    by_bl: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for f in room_features:
        props = f.get("properties") or {}
        b = props.get("building")
        l = props.get("level")
        if b and l is not None:
            by_bl[(b, l)].append(f)

    outline_features: list[dict] = []
    for (b, l), feats in by_bl.items():
        base = feats[0]["properties"]["base"]
        edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
        for f in feats:
            geom = f.get("geometry") or {}
            coords = geom.get("coordinates", [])
            gtype = geom.get("type")
            rings = coords if gtype == "Polygon" else [r for poly in coords for r in poly]
            for ring in rings:
                for i in range(len(ring) - 1):
                    p1 = (round(ring[i][0], 7), round(ring[i][1], 7))
                    p2 = (round(ring[i + 1][0], 7), round(ring[i + 1][1], 7))
                    if p1 != p2:
                        edges.add(tuple(sorted([p1, p2])))

        quads: list[list[list[float]]] = []
        for p1, p2 in edges:
            dx_m = (p2[0] - p1[0]) * m_per_deg_lon
            dy_m = (p2[1] - p1[1]) * m_per_deg_lat
            length = math.hypot(dx_m, dy_m)
            if length < 0.05:
                continue
            ux = dx_m / length
            uy = dy_m / length
            ext_x = (ux * half_w) / m_per_deg_lon
            ext_y = (uy * half_w) / m_per_deg_lat

            nx = -dy_m / length
            ny = dx_m / length
            off_x = (nx * half_w) / m_per_deg_lon
            off_y = (ny * half_w) / m_per_deg_lat

            v1 = [round(p1[0] - ext_x + off_x, 7), round(p1[1] - ext_y + off_y, 7)]
            v2 = [round(p2[0] + ext_x + off_x, 7), round(p2[1] + ext_y + off_y, 7)]
            v3 = [round(p2[0] + ext_x - off_x, 7), round(p2[1] + ext_y - off_y, 7)]
            v4 = [round(p1[0] - ext_x - off_x, 7), round(p1[1] - ext_y - off_y, 7)]
            quads.append([[v1, v2, v3, v4, v1]])

        if quads:
            feat_id = f"room-outline-{b}-{l}"
            outline_features.append(
                {
                    "type": "Feature",
                    "id": feat_id,
                    "properties": {
                        "id": feat_id,
                        "kind": "room-outline",
                        "building": b,
                        "level": l,
                        "roomId": "",
                        "name": "Room Outlines",
                        "base": base,
                        "height": round(base + 0.28, 2),
                        "scope": "indoor",
                        "color": "#848994",
                    },
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": quads,
                    },
                }
            )
    return outline_features


def _properties(
    feature_id: str,
    *,
    kind: str,
    building: str,
    level: int | None,
    room_id: str,
    name: str,
    base: float,
    height: float,
    scope: str,
    color: str = "",
) -> dict:
    return {
        "id": feature_id,
        "kind": kind,
        "building": building,
        "level": level,
        "roomId": room_id,
        "name": name,
        "base": base,
        "height": height,
        "scope": scope,
        "color": color,
    }


def convert(
    maps: list[dict],
    spaces_by_map: dict[str, list[dict]],
    polygon_layers: dict[str, str] | None = None,
    styles: dict[str, str] | None = None,
) -> dict:
    polygon_layers = polygon_layers or {}
    styles = styles or {}
    group_buildings = _group_buildings(maps, spaces_by_map)
    features: list[dict] = []

    for mapped_map in maps:
        map_id = mapped_map["id"]
        spaces = spaces_by_map.get(map_id, [])
        is_outdoor = "outdoor" in (mapped_map.get("name") or "").lower()

        if is_outdoor:
            named_external_ids = {
                (feature.get("properties") or {}).get("externalId")
                for feature in spaces
                if _feature_name(feature) in BUILDINGS
            }
            for feature in spaces:
                props = feature.get("properties") or {}
                feature_id = _feature_id(feature)
                name = _feature_name(feature)
                layer = polygon_layers.get(_raw_id(feature), "")
                external_id = props.get("externalId")

                building_info = BUILDINGS.get(name)
                if building_info:
                    building, storeys = building_info
                    kind = "mass"
                    height = storeys * STOREY_M
                    color = "#5b238a"
                elif layer == "Dynamic - Building" or external_id in named_external_ids:
                    continue
                elif layer == "Dynamic - Bridges":
                    building = ""
                    kind = "bridge"
                    height = BRIDGE_HEIGHT_M
                    color = "#5b238a"
                else:
                    building = ""
                    kind = "context"
                    height = 0.0
                    color = ""

                base = BRIDGE_BASE_M if kind == "bridge" else 0.0

                features.append(
                    {
                        "type": "Feature",
                        "id": feature_id,
                        "geometry": feature["geometry"],
                        "properties": _properties(
                            feature_id,
                            kind=kind,
                            building=building,
                            level=None,
                            room_id="",
                            name=name,
                            base=base,
                            height=height,
                            scope="campus",
                            color=color,
                        ),
                    }
                )
            continue

        level = parse_level(
            mapped_map.get("name") or "",
            mapped_map.get("shortName") or "",
            mapped_map.get("elevation"),
        )
        building = group_buildings.get(mapped_map.get("group") or "", "")
        base = max(0.0, (level - 1) * STOREY_M)

        for feature in spaces:
            if feature.get("geometry", {}).get("type") not in {"Polygon", "MultiPolygon"}:
                continue
            feature_id = _feature_id(feature)
            raw_id = _raw_id(feature)
            if raw_id in IGNORED_PILLAR_IDS:
                continue
            props = feature.get("properties") or {}
            name = _feature_name(feature)
            layer = polygon_layers.get(raw_id, "")
            is_walkable = bool(props.get("destinationNodes"))

            venue_color = styles.get(f"s_{raw_id}", styles.get(raw_id, ""))

            if layer == "Floor":
                kind = "floor"
                thickness = FLOOR_HEIGHT_M
                room_id = ""
                color = venue_color or "#e6e6e6"
            elif layer == "Wall":
                kind = "wall"
                thickness = WALL_HEIGHT_M
                room_id = ""
                color = venue_color or "#9f9f9f"
            elif name:
                kind = "room"
                thickness = ROOM_HEIGHT_M
                room_id = canonical_room_id(name, str(props.get("externalId") or ""))
                color = venue_color or "#ffffff"
            elif layer == "Connection" or (not layer and is_walkable):
                kind = "hallway"
                thickness = HALLWAY_HEIGHT_M
                room_id = ""
                color = venue_color or "#cdd6e0"
            else:
                continue

            features.append(
                {
                    "type": "Feature",
                    "id": feature_id,
                    "geometry": feature["geometry"],
                    "properties": _properties(
                        feature_id,
                        kind=kind,
                        building=building,
                        level=level,
                        room_id=room_id,
                        name=name,
                        base=base,
                        height=base + thickness,
                        scope="indoor",
                        color=color,
                    ),
                }
            )

    room_features = [f for f in features if f["properties"].get("kind") == "room"]
    outlines = build_room_outlines(room_features)
    features.extend(outlines)

    return {"type": "FeatureCollection", "features": features}


def load_spaces(venue_path: Path, maps: list[dict]) -> dict[str, list[dict]]:
    spaces_by_map: dict[str, list[dict]] = {}
    with zipfile.ZipFile(venue_path) as venue:
        for mapped_map in maps:
            map_id = mapped_map["id"]
            entry = f"space/f_{map_id}.geojson"
            try:
                with venue.open(entry) as source:
                    spaces_by_map[map_id] = json.load(source).get("features", [])
            except KeyError:
                spaces_by_map[map_id] = []
    return spaces_by_map


def load_polygon_layers(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    return {
        polygon["id"]: polygon.get("layer", "")
        for polygon in json.loads(path.read_text(encoding="utf-8"))
        if polygon.get("id")
    }


def main() -> None:
    maps = json.loads((RAW_DIR / "map.json").read_text(encoding="utf-8"))
    spaces_by_map = load_spaces(RAW_DIR / "venue.zip", maps)
    polygon_layers = load_polygon_layers(RAW_DIR / "polygon.json")
    styles = load_styles(RAW_DIR / "venue.zip")
    fc = convert(maps, spaces_by_map, polygon_layers, styles)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = OUT_PATH.with_suffix(".geojson.tmp")
    temp_path.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    temp_path.replace(OUT_PATH)

    counts = Counter(feature["properties"]["kind"] for feature in fc["features"])
    n304 = sum(
        feature["properties"]["kind"] == "room" and feature["properties"]["roomId"] == "N304"
        for feature in fc["features"]
    )
    print(f"wrote {OUT_PATH} features={len(fc['features'])} kinds={dict(counts)} n304={n304}")


if __name__ == "__main__":
    main()
