import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from convert_to_geojson import convert, parse_level


def hunter_map(**overrides):
    base = {
        "id": "map-n3",
        "name": "Level 3",
        "shortName": "L3",
        "width": 100,
        "height": 100,
        "group": "north-group",
        "elevation": 2,
        "georeference": [
            {"control": {"x": 0, "y": 0}, "target": {"x": 40.77, "y": -73.97}},
            {"control": {"x": 100, "y": 0}, "target": {"x": 40.77, "y": -73.96}},
            {"control": {"x": 100, "y": 100}, "target": {"x": 40.76, "y": -73.96}},
            {"control": {"x": 0, "y": 100}, "target": {"x": 40.76, "y": -73.97}},
        ],
    }
    base.update(overrides)
    return base


class ParseLevelTests(unittest.TestCase):
    def test_numbered_level(self):
        self.assertEqual(parse_level("Level 3", "L3", 2), 3)

    def test_basement_without_number_is_zero(self):
        self.assertEqual(parse_level("Basement", "B", -1), 0)

    def test_basement_two(self):
        self.assertEqual(parse_level("Basement 2", "B2", -2), -2)


class ConvertTests(unittest.TestCase):
    def test_room_polygon_is_wgs84_with_hunter_properties(self):
        maps = [hunter_map()]
        polygons = [
            {
                "id": "poly-n304",
                "map": "map-n3",
                "layer": "Polygon",
                "vertexes": [
                    {"x": 0, "y": 0},
                    {"x": 10, "y": 0},
                    {"x": 10, "y": 10},
                    {"x": 0, "y": 10},
                ],
                "geometry": {"scale": {"z": 2.0}},
            }
        ]
        locations = [
            {
                "name": "N304",
                "type": "room",
                "polygons": [{"id": "poly-n304", "map": "map-n3"}],
            }
        ]

        fc = convert(maps, polygons, locations)
        self.assertEqual(fc["type"], "FeatureCollection")
        self.assertEqual(len(fc["features"]), 1)
        feat = fc["features"][0]
        self.assertEqual(feat["properties"]["building"], "N")
        self.assertEqual(feat["properties"]["level"], 3)
        self.assertEqual(feat["properties"]["roomId"], "N304")
        self.assertEqual(feat["properties"]["kind"], "room")
        lon, lat = feat["geometry"]["coordinates"][0][0]
        self.assertAlmostEqual(lon, -73.97, places=5)
        self.assertAlmostEqual(lat, 40.77, places=5)
        self.assertTrue(-74.1 < lon < -73.8)
        self.assertTrue(40.6 < lat < 40.9)

    def test_wall_and_connection_kinds(self):
        maps = [hunter_map()]
        polygons = [
            {
                "id": "wall-1",
                "map": "map-n3",
                "layer": "Wall",
                "vertexes": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
            },
            {
                "id": "hall-1",
                "map": "map-n3",
                "layer": "Connection",
                "vertexes": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
            },
        ]
        kinds = {f["properties"]["kind"] for f in convert(maps, polygons, [])["features"]}
        self.assertEqual(kinds, {"wall", "hallway"})

    def test_keeps_outdoor_footprint_and_skips_void(self):
        maps = [
            hunter_map(id="outdoor", name="Outdoor ", group="out"),
            hunter_map(),
        ]
        polygons = [
            {
                "id": "outdoors",
                "map": "outdoor",
                "layer": "Building Footprint",
                "vertexes": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
            },
            {
                "id": "void",
                "map": "map-n3",
                "layer": "Void",
                "vertexes": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
            },
        ]
        features = convert(maps, polygons, [])["features"]
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0]["properties"]["kind"], "footprint")
        self.assertEqual(features[0]["properties"]["scope"], "campus")
        self.assertIsNone(features[0]["properties"]["level"])

    def test_rotates_outdoor_when_indoor_heading_differs(self):
        indoor = hunter_map(
            georeference=[
                {"control": {"x": 0, "y": 0}, "target": {"x": 40.770, "y": -73.970}},
                {"control": {"x": 100, "y": 0}, "target": {"x": 40.769, "y": -73.960}},
                {"control": {"x": 100, "y": 100}, "target": {"x": 40.760, "y": -73.961}},
                {"control": {"x": 0, "y": 100}, "target": {"x": 40.761, "y": -73.971}},
            ]
        )
        outdoor = hunter_map(id="outdoor", name="Outdoor ", group="out")
        polygons = [
            {
                "id": "fp",
                "map": "outdoor",
                "layer": "Building Footprint",
                "vertexes": [{"x": 100, "y": 0}, {"x": 90, "y": 0}, {"x": 90, "y": 10}],
            }
        ]
        unrotated = convert([outdoor], polygons, [])["features"][0]["geometry"]["coordinates"][0][0]
        rotated = convert([outdoor, indoor], polygons, [])["features"][0]["geometry"]["coordinates"][0][0]
        self.assertNotAlmostEqual(unrotated[0], rotated[0], places=6)
        self.assertTrue(-74.1 < rotated[0] < -73.8)
        self.assertTrue(40.6 < rotated[1] < 40.9)

    def test_floor_plate_builds_3d_mass(self):
        maps = [hunter_map(name="Level 1", shortName="L1", elevation=0)]
        polygons = [
            {
                "id": "room-n",
                "map": "map-n3",
                "layer": "Polygon",
                "vertexes": [{"x": 0, "y": 0}, {"x": 2, "y": 0}, {"x": 2, "y": 2}],
            },
            {
                "id": "floor-n",
                "map": "map-n3",
                "layer": "Floor",
                "vertexes": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}],
            },
        ]
        locations = [
            {
                "name": "N101",
                "type": "room",
                "polygons": [{"id": "room-n", "map": "map-n3"}],
            }
        ]
        kinds = {f["properties"]["kind"] for f in convert(maps, polygons, locations)["features"]}
        self.assertIn("plate", kinds)
        self.assertIn("mass", kinds)
        mass = next(f for f in convert(maps, polygons, locations)["features"] if f["properties"]["kind"] == "mass")
        self.assertEqual(mass["properties"]["building"], "N")
        self.assertAlmostEqual(mass["properties"]["height"], 16 * 3.5)

    def test_west_basement_prefix_maps_to_w(self):
        maps = [hunter_map(id="map-w", group="west-group", name="Basement 1")]
        polygons = [
            {
                "id": "wb",
                "map": "map-w",
                "layer": "Polygon",
                "vertexes": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
            }
        ]
        locations = [
            {
                "name": "WB304A",
                "type": "room",
                "polygons": [{"id": "wb", "map": "map-w"}],
            }
        ]
        feat = convert(maps, polygons, locations)["features"][0]
        self.assertEqual(feat["properties"]["building"], "W")
        self.assertEqual(feat["properties"]["level"], -1)


if __name__ == "__main__":
    unittest.main()
