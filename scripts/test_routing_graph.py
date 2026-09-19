"""Unit tests for offline routing graph generation and network connectivity."""

from __future__ import annotations

import heapq
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_routing_graph import OUT_PATH, build_routing_graph, haversine_meters


def dijkstra_path(
    nodes: dict[str, dict],
    edges: list[dict],
    start: str,
    target: str,
    accessible_only: bool = False,
) -> tuple[list[str] | None, float]:
    adj: dict[str, list[tuple[str, float]]] = {nid: [] for nid in nodes}
    for edge in edges:
        if accessible_only and not edge["accessible"]:
            continue
        n1 = edge["from"]
        n2 = edge["to"]
        dist = edge["distance"]
        if n1 in adj and n2 in adj:
            adj[n1].append((n2, dist))
            adj[n2].append((n1, dist))

    dist_map: dict[str, float] = {start: 0.0}
    prev: dict[str, str] = {}
    pq = [(0.0, start)]

    while pq:
        d, curr = heapq.heappop(pq)
        if curr == target:
            break
        if d > dist_map[curr]:
            continue
        for nxt, weight in adj.get(curr, []):
            cost = d + weight
            if cost < dist_map.get(nxt, float("inf")):
                dist_map[nxt] = cost
                prev[nxt] = curr
                heapq.heappush(pq, (cost, nxt))

    if target not in dist_map:
        return None, float("inf")

    path = []
    curr = target
    while curr != start:
        path.append(curr)
        curr = prev[curr]
    path.append(start)
    path.reverse()
    return path, dist_map[target]


class RoutingGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph_path = OUT_PATH
        cls.assertTrue(cls, cls.graph_path.exists(), f"Missing routing graph at {cls.graph_path}")
        cls.data = json.loads(cls.graph_path.read_text(encoding="utf-8"))
        cls.nodes = cls.data["nodes"]
        cls.edges = cls.data["edges"]
        cls.rooms = cls.data["rooms"]

    def test_haversine_distance(self):
        # Coordinates approximately 100m apart
        p1 = [-73.9646, 40.7685]
        p2 = [-73.9646, 40.7694]
        dist = haversine_meters(p1, p2)
        self.assertAlmostEqual(dist, 100.0, delta=5.0)

    def test_graph_node_and_edge_counts(self):
        self.assertGreater(len(self.nodes), 7000)
        self.assertGreater(len(self.edges), 10000)
        self.assertGreater(len(self.rooms), 2500)

    def test_node_schema(self):
        sample = next(iter(self.nodes.values()))
        self.assertIn("coordinates", sample)
        self.assertEqual(len(sample["coordinates"]), 2)
        self.assertIn("building", sample)
        self.assertIn("level", sample)
        self.assertIsInstance(sample["level"], int)

    def test_edge_schema_and_types(self):
        types_found = {edge["type"] for edge in self.edges}
        self.assertIn("walk", types_found)
        self.assertIn("bridge", types_found)

        for edge in self.edges[:100]:
            self.assertIn(edge["from"], self.nodes)
            self.assertIn(edge["to"], self.nodes)
            self.assertGreater(edge["distance"], 0)
            self.assertIsInstance(edge["accessible"], bool)

    def test_key_campus_rooms_mapped(self):
        for room_id, expected_building, expected_level in [
            ("N304", "N", 3),
            ("W424", "W", 4),
            ("E401", "E", 4),
            ("TH105", "TH", 1),
        ]:
            self.assertIn(room_id, self.rooms)
            room = self.rooms[room_id]
            self.assertEqual(room["building"], expected_building)
            self.assertEqual(room["level"], expected_level)
            self.assertIn(room["nodeId"], self.nodes)

    def test_intra_floor_pathfinding_n304_to_n302(self):
        start_node = self.rooms["N304"]["nodeId"]
        target_node = self.rooms["N302"]["nodeId"]
        path, cost = dijkstra_path(self.nodes, self.edges, start_node, target_node)

        self.assertIsNotNone(path)
        self.assertGreater(len(path), 1)
        self.assertLess(cost, 80.0)  # ~35m walking distance

    def test_cross_building_skybridge_pathfinding_west_to_east(self):
        # West level 3 to East level 3 across the Lexington Ave skybridge
        w_room = self.rooms["W305"]["nodeId"]
        e_room = self.rooms["E303"]["nodeId"]
        path, cost = dijkstra_path(self.nodes, self.edges, w_room, e_room)

        self.assertIsNotNone(path)
        self.assertGreater(len(path), 10)
        # Check that path visits both 'W' and 'E' nodes
        visited_buildings = {self.nodes[nid]["building"] for nid in path}
        self.assertIn("W", visited_buildings)
        self.assertIn("E", visited_buildings)

    def test_multi_floor_pathfinding_n304_to_n510(self):
        start_node = self.rooms["N304"]["nodeId"]
        target_node = self.rooms["N510"]["nodeId"]
        path, cost = dijkstra_path(self.nodes, self.edges, start_node, target_node)

        self.assertIsNotNone(path)
        visited_levels = {self.nodes[nid]["level"] for nid in path}
        self.assertIn(3, visited_levels)
        self.assertIn(5, visited_levels)

    def test_accessible_path_avoids_stairs(self):
        start_node = self.rooms["N304"]["nodeId"]
        target_node = self.rooms["N510"]["nodeId"]
        path, cost = dijkstra_path(self.nodes, self.edges, start_node, target_node, accessible_only=True)

        self.assertIsNotNone(path)
        # Verify no stairs in accessible path
        edge_lookup = {
            tuple(sorted([e["from"], e["to"]])): e for e in self.edges
        }
        for i in range(len(path) - 1):
            edge = edge_lookup.get(tuple(sorted([path[i], path[i + 1]])))
            if edge:
                self.assertTrue(edge["accessible"])
                self.assertNotIn(edge["type"], {"stairs", "escalator"})


if __name__ == "__main__":
    unittest.main()
