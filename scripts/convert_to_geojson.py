"""Normalize Mappedin HAR extracts to WGS84 GeoJSON for MapLibre."""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
OUT_PATH = ROOT / "apps" / "web" / "public" / "data" / "hunter-floors.geojson"

KIND_BY_LAYER = {
    "Polygon": "room",
    "Washroom": "room",
    "Non Public": "room",
    "Entrance": "room",
    "Connection": "hallway",
    "Floor": "plate",
    "Wall": "wall",
    "Building Footprint": "footprint",
    "Dynamic - Bridges": "bridge",
}

SKIP_LAYERS = {
    "Void",
    "Dynamic - Building",
    "External Building",
    "Dynamic - Extra",
}

STOREY_M = 3.5
FLOOR_COUNT = {"N": 16, "E": 18, "W": 17, "TH": 7, "BTB": 6}

HEIGHT_BY_KIND = {
    "wall": 3.2,
    "room": 3.2,
    "hallway": 0.55,
    "plate": 3.5,
    "footprint": 0,
    "bridge": 0.4,
    "mass": 0,
}

METERS_PER_DEG_LAT = 110540.0

PREFIXES = (
    ("BTB", "BTB"),
    ("TH", "TH"),
    ("WB", "W"),
    ("EB", "E"),
    ("HN", "N"),
    ("HW", "W"),
    ("HE", "E"),
    ("N", "N"),
    ("W", "W"),
    ("E", "E"),
    ("C", "N"),
)


def parse_level(name: str, short_name: str = "", elevation: int | float | None = None) -> int:
    text = f"{name} {short_name}".strip()
    lower = text.lower()
    if "concourse" in lower:
        return 0
    if "ground" in lower:
        return 1
    if "basement" in lower or re.search(r"\bB\d+\b", text):
        nums = re.findall(r"\d+", text)
        return -int(nums[0]) if nums else 0
    level_match = re.search(r"(?:level|l)\s*(\d+)", lower)
    if level_match:
        return int(level_match.group(1))
    if elevation is None:
        return 1
    return int(elevation) + 1


def building_from_name(name: str) -> str | None:
    token = re.sub(r"[\s\-]", "", (name or "")).upper()
    for prefix, building in PREFIXES:
        if token.startswith(prefix):
            return building
    return None


def _heading_deg(mapped_map: dict) -> float:
    """Heading of canvas +x in local east/north degrees (0 = east)."""
    width = float(mapped_map["width"])
    height = float(mapped_map["height"])
    top = [point for point in mapped_map["georeference"] if point["control"]["y"] < height / 2]
    west = min(top, key=lambda point: point["control"]["x"])
    east = max(top, key=lambda point: point["control"]["x"])
    lat0, lon0 = west["target"]["x"], west["target"]["y"]
    lat1, lon1 = east["target"]["x"], east["target"]["y"]
    mid_lat = math.radians((lat0 + lat1) / 2)
    east_m = (lon1 - lon0) * METERS_PER_DEG_LAT * math.cos(mid_lat)
    north_m = (lat1 - lat0) * METERS_PER_DEG_LAT
    return math.degrees(math.atan2(north_m, east_m))


def _georeference_center(mapped_map: dict) -> tuple[float, float]:
    lons = [point["target"]["y"] for point in mapped_map["georeference"]]
    lats = [point["target"]["x"] for point in mapped_map["georeference"]]
    return sum(lons) / len(lons), sum(lats) / len(lats)


def _rotate_lonlat(lon: float, lat: float, origin_lon: float, origin_lat: float, angle_deg: float) -> list[float]:
    rad = math.radians(angle_deg)
    cos_lat = math.cos(math.radians(origin_lat))
    east = (lon - origin_lon) * METERS_PER_DEG_LAT * cos_lat
    north = (lat - origin_lat) * METERS_PER_DEG_LAT
    east_r = east * math.cos(rad) - north * math.sin(rad)
    north_r = east * math.sin(rad) + north * math.cos(rad)
    return [origin_lon + east_r / (METERS_PER_DEG_LAT * cos_lat), origin_lat + north_r / METERS_PER_DEG_LAT]


def _make_transform(mapped_map: dict, heading_adjust_deg: float = 0.0):
    width = float(mapped_map["width"])
    height = float(mapped_map["height"])
    corners: dict[tuple[float, float], tuple[float, float]] = {}
    for point in mapped_map["georeference"]:
        cx = point["control"]["x"]
        cy = point["control"]["y"]
        sx = 0.0 if cx < width / 2 else width
        sy = 0.0 if cy < height / 2 else height
        corners[(sx, sy)] = (point["target"]["y"], point["target"]["x"])
    p00 = corners[(0.0, 0.0)]
    p10 = corners[(width, 0.0)]
    p11 = corners[(width, height)]
    p01 = corners[(0.0, height)]
    origin_lon, origin_lat = _georeference_center(mapped_map)

    def xy_to_lonlat(x: float, y: float) -> list[float]:
        u = x / width
        v = y / height
        lon = (
            (1 - u) * (1 - v) * p00[0]
            + u * (1 - v) * p10[0]
            + u * v * p11[0]
            + (1 - u) * v * p01[0]
        )
        lat = (
            (1 - u) * (1 - v) * p00[1]
            + u * (1 - v) * p10[1]
            + u * v * p11[1]
            + (1 - u) * v * p01[1]
        )
        if heading_adjust_deg:
            return _rotate_lonlat(lon, lat, origin_lon, origin_lat, heading_adjust_deg)
        return [lon, lat]

    return xy_to_lonlat


def _close_ring(ring: list[list[float]]) -> list[list[float]]:
    if ring[0] != ring[-1]:
        return ring + [ring[0]]
    return ring


def _ring(vertexes: list[dict], transform) -> list[list[float]]:
    return _close_ring([transform(v["x"], v["y"]) for v in vertexes])


def _group_buildings(maps: dict[str, dict], locations: list[dict]) -> dict[str, str]:
    votes: dict[str, Counter[str]] = defaultdict(Counter)
    for loc in locations:
        if loc.get("type") != "room":
            continue
        building = building_from_name(loc.get("name") or "")
        if not building:
            continue
        for ref in loc.get("polygons") or []:
            mapped_map = maps.get(ref.get("map"))
            if mapped_map:
                votes[mapped_map["group"]][building] += 1
    return {group: counts.most_common(1)[0][0] for group, counts in votes.items() if counts}


def _ring_area(ring: list[list[float]]) -> float:
    area = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def _add_building_masses(features: list[dict]) -> None:
    best: dict[str, tuple[float, dict]] = {}
    for feature in features:
        props = feature["properties"]
        if props["kind"] != "plate" or not props["building"]:
            continue
        area = _ring_area(feature["geometry"]["coordinates"][0])
        if props.get("level") == 1:
            area *= 1.25
        building = props["building"]
        current = best.get(building)
        if current is None or area > current[0]:
            best[building] = (area, feature)
    for building, (_, plate) in best.items():
        storeys = FLOOR_COUNT.get(building, 10)
        features.append(
            {
                "type": "Feature",
                "id": f"{plate['id']}-mass",
                "geometry": plate["geometry"],
                "properties": {
                    "id": f"{plate['id']}-mass",
                    "level": None,
                    "building": building,
                    "roomId": "",
                    "kind": "mass",
                    "scope": "campus",
                    "name": building,
                    "height": storeys * STOREY_M,
                    "storeys": storeys,
                },
            }
        )


def convert(maps: list[dict], polygons: list[dict], locations: list[dict]) -> dict:
    maps_by_id = {m["id"]: m for m in maps}
    indoor_maps = [
        mapped_map
        for mapped_map in maps
        if mapped_map.get("georeference") and "outdoor" not in (mapped_map.get("name") or "").lower()
    ]
    outdoor_maps = [
        mapped_map
        for mapped_map in maps
        if mapped_map.get("georeference") and "outdoor" in (mapped_map.get("name") or "").lower()
    ]
    heading_adjust = 0.0
    if indoor_maps and outdoor_maps:
        heading_adjust = _heading_deg(indoor_maps[0]) - _heading_deg(outdoor_maps[0])
    transforms = {
        mid: _make_transform(
            mapped_map,
            heading_adjust if "outdoor" in (mapped_map.get("name") or "").lower() else 0.0,
        )
        for mid, mapped_map in maps_by_id.items()
        if mapped_map.get("georeference")
    }
    group_building = _group_buildings(maps_by_id, locations)

    loc_by_poly = {}
    for loc in locations:
        if loc.get("type") != "room":
            continue
        for ref in loc.get("polygons") or []:
            loc_by_poly[ref["id"]] = loc

    features = []
    for poly in polygons:
        mapped_map = maps_by_id.get(poly.get("map"))
        if not mapped_map:
            continue
        transform = transforms.get(mapped_map["id"])
        if not transform:
            continue
        layer = poly.get("layer") or ""
        if layer in SKIP_LAYERS:
            continue
        is_outdoor = "outdoor" in (mapped_map.get("name") or "").lower()
        kind = "entrance" if is_outdoor and layer == "Entrance" else KIND_BY_LAYER.get(layer)
        if not kind:
            continue
        if is_outdoor and kind not in {"footprint", "bridge"}:
            continue
        vertexes = poly.get("vertexes") or []
        if len(vertexes) < 3:
            continue

        loc = loc_by_poly.get(poly["id"])
        name = (loc or {}).get("name") or ""
        building = "" if is_outdoor else group_building.get(mapped_map["group"]) or building_from_name(name) or ""
        level = None if is_outdoor else parse_level(
            mapped_map.get("name") or "",
            mapped_map.get("shortName") or "",
            mapped_map.get("elevation"),
        )
        height = HEIGHT_BY_KIND[kind]
        rings = [_ring(vertexes, transform)]
        for hole in poly.get("holes") or []:
            if len(hole) >= 3:
                rings.append(_ring(hole, transform))

        features.append(
            {
                "type": "Feature",
                "id": poly["id"],
                "geometry": {"type": "Polygon", "coordinates": rings},
                "properties": {
                    "id": poly["id"],
                    "level": level,
                    "building": building,
                    "roomId": name,
                    "kind": kind,
                    "scope": "campus" if is_outdoor else "indoor",
                    "name": name,
                    "height": height,
                    "storeys": FLOOR_COUNT.get(building, 0),
                },
            }
        )

    _add_building_masses(features)
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    maps = json.loads((RAW_DIR / "map.json").read_text(encoding="utf-8"))
    polygons = json.loads((RAW_DIR / "polygon.json").read_text(encoding="utf-8"))
    locations = json.loads((RAW_DIR / "location.json").read_text(encoding="utf-8"))
    fc = convert(maps, polygons, locations)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(fc), encoding="utf-8")
    n3 = sum(1 for f in fc["features"] if f["properties"]["building"] == "N" and f["properties"]["level"] == 3)
    w3 = sum(1 for f in fc["features"] if f["properties"]["building"] == "W" and f["properties"]["level"] == 3)
    campus = sum(1 for f in fc["features"] if f["properties"]["scope"] == "campus")
    rooms = sum(1 for f in fc["features"] if f["properties"]["roomId"] == "N304")
    print(f"wrote {OUT_PATH} features={len(fc['features'])} campus={campus} north3={n3} west3={w3} n304={rooms}")


if __name__ == "__main__":
    main()
