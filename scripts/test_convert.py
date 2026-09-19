import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from convert_to_geojson import canonical_room_id, convert, parse_level


def mapped_map(map_id="north-3", **overrides):
    item = {
        "id": map_id,
        "name": "Level 3",
        "shortName": "L3",
        "elevation": 2,
        "group": "north-group",
    }
    item.update(overrides)
    return item


def space(feature_id, name="", external_id="POLY-1", destination_nodes=None):
    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[-73.9652, 40.7687], [-73.9651, 40.7687], [-73.9651, 40.7688], [-73.9652, 40.7687]]],
        },
        "properties": {
            "id": f"s_{feature_id}",
            "externalId": external_id,
            "destinationNodes": destination_nodes or [],
            "details": {"name": name, "images": []},
        },
    }


class ParseTests(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(parse_level("Level 3", "L3", 2), 3)
        self.assertEqual(parse_level("Concourse", "Concourse", -1), 0)
        self.assertEqual(parse_level("Basement 2", "B2", -2), -2)
        self.assertEqual(parse_level("Ground Floor", "Ground Floor", -1), 0)

    def test_room_ids_match_the_web_parser(self):
        self.assertEqual(canonical_room_id("N304"), "N304")
        self.assertEqual(canonical_room_id("HN 304"), "N304")
        self.assertEqual(canonical_room_id("W424 Classroom"), "W424")
        self.assertEqual(canonical_room_id("E401-F"), "E401F")
        self.assertEqual(canonical_room_id("C111"), "C111")
        self.assertEqual(canonical_room_id("EB103A"), "EB103A")
        self.assertEqual(canonical_room_id("Women's Washroom"), "Women's Washroom")


class ConvertTests(unittest.TestCase):
    def test_named_outdoor_spaces_become_exact_masses(self):
        outdoor = mapped_map("outdoor", name="Outdoor ", shortName="Outdoor", elevation=0, group="campus")
        original = space("north", "North Building", "NORTH")
        duplicate = space("north-copy", "", "NORTH")
        bridge = space("bridge", "", "BRIDGE")

        fc = convert(
            [outdoor],
            {"outdoor": [original, duplicate, bridge]},
            {"north": "Building Footprint", "north-copy": "Dynamic - Building", "bridge": "Dynamic - Bridges"},
        )

        self.assertEqual([feature["properties"]["kind"] for feature in fc["features"]], ["mass", "bridge"])
        mass = fc["features"][0]
        self.assertEqual(mass["geometry"], original["geometry"])
        self.assertEqual(mass["properties"]["building"], "N")
        self.assertEqual(mass["properties"]["height"], 16 * 3.5)
        self.assertEqual(mass["properties"]["scope"], "campus")
        self.assertEqual(fc["features"][1]["properties"]["base"], 7.0)
        self.assertEqual(fc["features"][1]["properties"]["height"], 9.6)

    def test_n304_and_hallway_use_floor_three_absolute_heights(self):
        maps = [mapped_map()]
        room = space("n304", "N304", "HN-304", ["node-1"])
        hallway = space("hall", destination_nodes=["node-2"])
        floor = space("floor")
        wall = space("wall")
        void = space("void")

        fc = convert(
            maps,
            {"north-3": [room, hallway, floor, wall, void]},
            {"n304": "Polygon", "hall": "Connection", "floor": "Floor", "wall": "Wall", "void": "Void"},
        )

        self.assertEqual(len(fc["features"]), 5)
        by_kind = {feature["properties"]["kind"]: feature for feature in fc["features"]}
        room_props = by_kind["room"]["properties"]
        self.assertEqual(room_props["roomId"], "N304")
        self.assertEqual(room_props["building"], "N")
        self.assertEqual(room_props["level"], 3)
        self.assertEqual(room_props["base"], 7.0)
        self.assertEqual(room_props["height"], 7.22)
        self.assertEqual(by_kind["hallway"]["properties"]["height"], 7.08)
        self.assertEqual(by_kind["floor"]["properties"]["height"], 7.04)
        self.assertEqual(by_kind["wall"]["properties"]["height"], 7.7)
        self.assertEqual(by_kind["room-outline"]["properties"]["kind"], "room-outline")
        self.assertEqual(by_kind["room-outline"]["properties"]["height"], 7.28)

    def test_layerless_walkable_space_falls_back_to_hallway(self):
        maps = [mapped_map()]
        hallway = space("hall", destination_nodes=["node-1"])
        fc = convert(maps, {"north-3": [hallway]})
        self.assertEqual(fc["features"][0]["properties"]["kind"], "hallway")

    def test_known_west_pillar_artifacts_are_ignored(self):
        artifacts = [
            space("684265bea08e5c2219058ac8"),
            space("68365f78db380b0b722f04db", destination_nodes=["node-1"]),
            space("683e7f154b67ba0b19e90924"),
        ]
        fc = convert(
            [mapped_map()],
            {"north-3": artifacts},
            {
                "684265bea08e5c2219058ac8": "Floor",
                "68365f78db380b0b722f04db": "Connection",
                "683e7f154b67ba0b19e90924": "Wall",
            },
        )
        self.assertEqual(fc["features"], [])


if __name__ == "__main__":
    unittest.main()
