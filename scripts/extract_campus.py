"""One-time extract: OSM college footprints -> campus.json + rooms.json."""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OSM_PATH = ROOT / "data" / "extract" / "osm-buildings-raw.json"
OUT_GEOJSON = ROOT / "data" / "extract" / "hunter-buildings.geojson"
OUT_CAMPUS = ROOT / "data" / "campus.json"
OUT_ROOMS = ROOT / "data" / "rooms.json"

ORIGIN_LAT = 40.7673
ORIGIN_LON = -73.9655
METERS_PER_DEG_LAT = 111320.0
METERS_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))

NAME_TO_BUILDING = {
    "North Building": {
        "id": "N",
        "name": "North Building",
        "floorCount": 16,
        "color": "#d4c4a8",
        "source": "openstreetmap",
    },
    "East Building": {
        "id": "E",
        "name": "East Building",
        "floorCount": 18,
        "color": "#9aa392",
        "source": "openstreetmap",
    },
    "West Building": {
        "id": "W",
        "name": "West Building",
        "floorCount": 17,
        "color": "#c4b8a8",
        "source": "openstreetmap",
    },
    "Thomas Hunter Building": {
        "id": "TH",
        "name": "Thomas Hunter Hall",
        "floorCount": 7,
        "color": "#b57a62",
        "source": "openstreetmap",
    },
}

# Baker Theatre Building is south of the main block (151 E 67th St).
BTB = {
    "id": "BTB",
    "name": "Baker Theatre Building",
    "floorCount": 6,
    "color": "#8c6b5a",
    "source": "approximated-address",
    "wgs84_ring": [
        (40.76652, -73.96412),
        (40.76662, -73.96388),
        (40.76638, -73.96372),
        (40.76628, -73.96396),
        (40.76652, -73.96412),
    ],
    "height": 24.0,
}


def to_xz(lat: float, lon: float) -> tuple[float, float]:
    x = (lon - ORIGIN_LON) * METERS_PER_DEG_LON
    z = (lat - ORIGIN_LAT) * METERS_PER_DEG_LAT
    return (round(x, 3), round(z, 3))


def rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points

    def perp_dist(p, a, b) -> float:
        ax, az = a
        bx, bz = b
        px, pz = p
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz) or 1.0
        return abs((pz - az) * dx - (px - ax) * dz) / length

    max_d = -1.0
    index = 0
    for i in range(1, len(points) - 1):
        d = perp_dist(points[i], points[0], points[-1])
        if d > max_d:
            index = i
            max_d = d
    if max_d > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def close_ring(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if points[0] != points[-1]:
        return points + [points[0]]
    return points


def centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    sx = sum(p[0] for p in pts)
    sz = sum(p[1] for p in pts)
    n = max(len(pts), 1)
    return (round(sx / n, 3), round(sz / n, 3))


def principal_axis(ring: list[tuple[float, float]]) -> tuple[tuple[float, float], tuple[float, float]]:
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    cx, cz = centroid(ring)
    cov_xx = cov_zz = cov_xz = 0.0
    for x, z in pts:
        dx, dz = x - cx, z - cz
        cov_xx += dx * dx
        cov_zz += dz * dz
        cov_xz += dx * dz
    n = max(len(pts), 1)
    cov_xx /= n
    cov_zz /= n
    cov_xz /= n
    theta = 0.5 * math.atan2(2 * cov_xz, cov_xx - cov_zz)
    return (cx, cz), (math.cos(theta), math.sin(theta))


def bounds_along_axis(ring, origin, axis) -> tuple[float, float]:
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    ox, oz = origin
    ax, az = axis
    dots = [(p[0] - ox) * ax + (p[1] - oz) * az for p in pts]
    return min(dots), max(dots)


def load_osm_buildings() -> list[dict]:
    raw = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    found: list[dict] = []
    for el in raw.get("elements", []):
        tags = el.get("tags") or {}
        name = tags.get("name")
        if name not in NAME_TO_BUILDING:
            continue
        geom = el.get("geometry") or []
        ring_wgs = [(p["lat"], p["lon"]) for p in geom]
        if len(ring_wgs) < 4:
            continue
        meta = dict(NAME_TO_BUILDING[name])
        height = float(tags["height"]) if "height" in tags else None
        levels = int(tags["building:levels"]) if "building:levels" in tags else meta["floorCount"]
        meta["osm_id"] = el.get("id")
        meta["osm_height"] = height
        meta["osm_levels"] = levels
        meta["wgs84_ring"] = ring_wgs
        found.append(meta)
    return found


def building_record(meta: dict) -> dict:
    ring_xz = close_ring([to_xz(lat, lon) for lat, lon in meta["wgs84_ring"]])
    simple = close_ring(rdp(ring_xz, epsilon=1.8))
    if len(simple) < 4:
        simple = ring_xz
    cx, cz = centroid(simple)
    floor_count = meta["floorCount"]
    height = meta.get("osm_height") or meta.get("height") or floor_count * 4.2
    floor_height = round(float(height) / floor_count, 3)
    record = {
        "id": meta["id"],
        "name": meta["name"],
        "floorCount": floor_count,
        "floorHeight": floor_height,
        "color": meta["color"],
        "source": meta["source"],
        "footprint": [list(p) for p in simple],
        "center": [cx, cz],
        "floors": [],
    }
    if meta.get("osm_id") is not None:
        record["osmWayId"] = meta["osm_id"]
    return record


def hallway_points(building: dict, floor: int, count: int) -> list[list[float]]:
    ring = [tuple(p) for p in building["footprint"]]
    origin, axis = principal_axis(ring)
    t0, t1 = bounds_along_axis(ring, origin, axis)
    # Stay inside the slab, not on the outer wall.
    margin = (t1 - t0) * 0.18
    y = round((floor - 1) * building["floorHeight"] + 1.5, 3)
    points = []
    for i in range(count):
        t = t0 + margin + (t1 - t0 - 2 * margin) * (i / max(count - 1, 1))
        x = origin[0] + axis[0] * t
        z = origin[1] + axis[1] * t
        points.append([round(x, 3), y, round(z, 3)])
    return points


def main() -> None:
    osm_buildings = load_osm_buildings()
    by_id = {b["id"]: building_record(b) for b in osm_buildings}
    by_id["BTB"] = building_record(BTB)

    order = ["N", "E", "W", "TH", "BTB"]
    missing = [bid for bid in order if bid not in by_id]
    if missing:
        raise SystemExit(f"Missing buildings: {missing}")

    north = by_id["N"]
    scan_y = round(2 * north["floorHeight"], 3)
    _, axis = principal_axis([tuple(p) for p in north["footprint"]])
    rotation_y = round(math.atan2(axis[1], axis[0]), 4)
    north["floors"] = [
        {
            "level": 3,
            "scan": {
                "url": "/models/floors/N/3-scan.glb",
                "position": [north["center"][0], scan_y, north["center"][1]],
                "rotationY": rotation_y,
                "scale": 1,
            },
        }
    ]

    campus = {
        "version": 1,
        "coordinateSystem": {
            "units": "meters",
            "up": "Y",
            "x": "east",
            "z": "north",
            "originWgs84": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        },
        "campusGltf": "/models/campus.glb",
        "buildings": [by_id[bid] for bid in order],
    }

    rooms_spec = [
        ("N304", "Classroom (scanned-floor demo)", "N", 3),
        ("N305", "Classroom", "N", 3),
        ("N306", "Classroom", "N", 3),
        ("N308", "Classroom", "N", 3),
        ("N150", "Testing Center", "N", 1),
        ("N217", "Bursar / Registrar", "N", 2),
        ("N241", "Financial Aid", "N", 2),
        ("E405", "Career Center", "E", 4),
        ("E1119", "Advising", "E", 11),
        ("E1214B", "Accessibility", "E", 12),
        ("W417", "Student Center", "W", 4),
        ("TH202", "Office of Student Activities", "TH", 2),
        ("BTB420", "Theatre classroom", "BTB", 4),
        ("BTB620", "Theatre studio", "BTB", 6),
    ]

    rooms = []
    grouped: dict[tuple[str, int], list[tuple[str, str]]] = {}
    for room_id, label, bid, floor in rooms_spec:
        grouped.setdefault((bid, floor), []).append((room_id, label))

    for (bid, floor), items in grouped.items():
        doors = hallway_points(by_id[bid], floor, len(items))
        for (room_id, label), door in zip(items, doors):
            rooms.append(
                {
                    "id": room_id,
                    "buildingId": bid,
                    "floor": floor,
                    "label": label,
                    "doorPosition": door,
                }
            )

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "id": b["id"],
                    "name": b["name"],
                    "source": b["source"],
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [
                                ORIGIN_LON + p[0] / METERS_PER_DEG_LON,
                                ORIGIN_LAT + p[1] / METERS_PER_DEG_LAT,
                            ]
                            for p in b["footprint"]
                        ]
                    ],
                },
            }
            for b in campus["buildings"]
        ],
    }

    OUT_GEOJSON.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    OUT_CAMPUS.write_text(json.dumps(campus, indent=2), encoding="utf-8")
    OUT_ROOMS.write_text(json.dumps({"version": 1, "rooms": rooms}, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_GEOJSON}")
    print(f"Wrote {OUT_CAMPUS}")
    print(f"Wrote {OUT_ROOMS}")
    print("Buildings:", [b["id"] for b in campus["buildings"]])
    print("Rooms:", [r["id"] for r in rooms])


if __name__ == "__main__":
    main()
