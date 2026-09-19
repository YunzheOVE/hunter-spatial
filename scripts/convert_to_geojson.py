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
        return 1
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
    }


def convert(
    maps: list[dict],
    spaces_by_map: dict[str, list[dict]],
    polygon_layers: dict[str, str] | None = None,
) -> dict:
    polygon_layers = polygon_layers or {}
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
                elif layer == "Dynamic - Building" or external_id in named_external_ids:
                    continue
                elif layer == "Dynamic - Bridges":
                    building = ""
                    kind = "bridge"
                    height = BRIDGE_HEIGHT_M
                else:
                    building = ""
                    kind = "context"
                    height = 0.0

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
            if _raw_id(feature) in IGNORED_PILLAR_IDS:
                continue
            props = feature.get("properties") or {}
            name = _feature_name(feature)
            layer = polygon_layers.get(_raw_id(feature), "")
            is_walkable = bool(props.get("destinationNodes"))
            if layer == "Floor":
                kind = "floor"
                thickness = FLOOR_HEIGHT_M
                room_id = ""
            elif layer == "Wall":
                kind = "wall"
                thickness = WALL_HEIGHT_M
                room_id = ""
            elif name:
                kind = "room"
                thickness = ROOM_HEIGHT_M
                room_id = canonical_room_id(name, str(props.get("externalId") or ""))
            elif layer == "Connection" or (not layer and is_walkable):
                kind = "hallway"
                thickness = HALLWAY_HEIGHT_M
                room_id = ""
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
                    ),
                }
            )
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
    fc = convert(maps, spaces_by_map, polygon_layers)
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
