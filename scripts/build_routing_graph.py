"""Build static routing graph JSON from raw Mappedin venue data."""

from __future__ import annotations

import json
import math
import zipfile
from pathlib import Path

from convert_to_geojson import (
    RAW_DIR,
    STOREY_M,
    _feature_name,
    _group_buildings,
    canonical_room_id,
    load_spaces,
    parse_level,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "apps" / "web" / "public" / "data" / "routing-graph.json"


def haversine_meters(coord1: list[float] | tuple[float, float], coord2: list[float] | tuple[float, float]) -> float:
    """Calculate great-circle distance between two [lon, lat] points in meters."""
    lon1, lat1 = coord1
    lon2, lat2 = coord2
    radius = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * radius * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def build_routing_graph(
    maps: list[dict],
    spaces_by_map: dict[str, list[dict]],
    nodes_geojson: dict,
    connections_json: list[dict],
) -> dict:
    """Convert venue nodes, connections, and space destination nodes into a clean routing graph."""
    group_buildings = _group_buildings(maps, spaces_by_map)

    map_lookup: dict[str, dict] = {}
    for mapped_map in maps:
        map_id = mapped_map["id"]
        level = parse_level(
            mapped_map.get("name") or "",
            mapped_map.get("shortName") or "",
            mapped_map.get("elevation"),
        )
        building = group_buildings.get(mapped_map.get("group") or "", "")
        map_lookup[map_id] = {"level": level, "building": building}

    # 1. Normalize nodes
    nodes: dict[str, dict] = {}
    for feature in nodes_geojson.get("features", []):
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        node_id = props.get("id")
        if not node_id or geom.get("type") != "Point":
            continue

        raw_map_id = str(props.get("map") or "").removeprefix("f_")
        map_info = map_lookup.get(raw_map_id, {"level": 1, "building": ""})
        coords = geom.get("coordinates") or [0.0, 0.0]

        nodes[node_id] = {
            "coordinates": [round(coords[0], 7), round(coords[1], 7)],
            "building": map_info["building"],
            "level": map_info["level"],
        }

    # 2. Index vertical/cross-building connectors from connection.json
    conn_pairs: dict[tuple[str, str], dict] = {}
    for conn in connections_json:
        c_nodes = conn.get("nodes") or []
        raw_type = conn.get("type", "connector")
        name = (conn.get("details") or {}).get("name", "")
        accessible = bool(conn.get("accessible", False))

        if "bridge" in name.lower() or "skybridge" in name.lower():
            edge_type = "bridge"
            accessible = True
        elif raw_type in {"elevator", "stairs", "escalator", "door"}:
            edge_type = raw_type
            if raw_type == "door":
                accessible = True
            elif raw_type == "elevator":
                accessible = True
            elif raw_type in {"stairs", "escalator"}:
                accessible = False
        else:
            edge_type = "connector"

        for i in range(len(c_nodes)):
            for j in range(i + 1, len(c_nodes)):
                pair = tuple(sorted([c_nodes[i], c_nodes[j]]))
                conn_pairs[pair] = {
                    "type": edge_type,
                    "accessible": accessible,
                    "name": name,
                }

    # 3. Build unique undirected edges
    edges: list[dict] = []
    seen_edges: set[tuple[str, str]] = set()

    for feature in nodes_geojson.get("features", []):
        props = feature.get("properties") or {}
        n1_id = props.get("id")
        if not n1_id or n1_id not in nodes:
            continue
        n1 = nodes[n1_id]

        for neighbor in props.get("neighbors") or []:
            n2_id = neighbor.get("id")
            if not n2_id or n2_id not in nodes or n1_id == n2_id:
                continue
            n2 = nodes[n2_id]

            pair = tuple(sorted([n1_id, n2_id]))
            if pair in seen_edges:
                continue
            seen_edges.add(pair)

            h_dist = haversine_meters(n1["coordinates"], n2["coordinates"])
            v_dist = abs(n1["level"] - n2["level"]) * STOREY_M
            edge_type = "walk"
            accessible = True

            if n1["building"] and n2["building"] and n1["building"] != n2["building"]:
                edge_type = "bridge"
                accessible = True
                distance = math.hypot(h_dist, v_dist)
            elif pair in conn_pairs:
                c_info = conn_pairs[pair]
                edge_type = c_info["type"]
                accessible = c_info["accessible"]
                distance = math.hypot(h_dist, v_dist)
            elif n1["level"] != n2["level"]:
                edge_type = "vertical"
                accessible = False
                distance = math.hypot(h_dist, v_dist)
            else:
                edge_type = "walk"
                accessible = True
                distance = h_dist

            edges.append(
                {
                    "from": n1_id,
                    "to": n2_id,
                    "distance": round(distance, 2),
                    "type": edge_type,
                    "accessible": accessible,
                }
            )

    # 4. Map canonical rooms to entrance nodes
    rooms: dict[str, dict] = {}
    for mapped_map in maps:
        map_id = mapped_map["id"]
        map_info = map_lookup.get(map_id, {"level": 1, "building": ""})
        spaces = spaces_by_map.get(map_id, [])

        for space in spaces:
            name = _feature_name(space)
            dest_nodes = (space.get("properties") or {}).get("destinationNodes") or []
            if not name or not dest_nodes:
                continue

            valid_nodes = [node_id for node_id in dest_nodes if node_id in nodes]
            if not valid_nodes:
                continue

            room_id = canonical_room_id(name, str((space.get("properties") or {}).get("externalId") or ""))
            if room_id not in rooms:
                rooms[room_id] = {
                    "building": map_info["building"],
                    "level": map_info["level"],
                    "nodeId": valid_nodes[0],
                    "name": name,
                }

    return {
        "nodes": nodes,
        "edges": edges,
        "rooms": rooms,
    }


def main() -> None:
    maps = json.loads((RAW_DIR / "map.json").read_text(encoding="utf-8"))
    spaces_by_map = load_spaces(RAW_DIR / "venue.zip", maps)

    with zipfile.ZipFile(RAW_DIR / "venue.zip") as venue:
        nodes_geojson = json.loads(venue.read("node.geojson").decode("utf-8"))
        connections_json = json.loads(venue.read("connection.json").decode("utf-8"))

    graph = build_routing_graph(maps, spaces_by_map, nodes_geojson, connections_json)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = OUT_PATH.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(graph, separators=(",", ":")), encoding="utf-8")
    temp_path.replace(OUT_PATH)

    print(
        f"Wrote {OUT_PATH} (nodes={len(graph['nodes'])}, "
        f"edges={len(graph['edges'])}, rooms={len(graph['rooms'])}, "
        f"size={OUT_PATH.stat().st_size / 1024:.1f} KB)"
    )


if __name__ == "__main__":
    main()
