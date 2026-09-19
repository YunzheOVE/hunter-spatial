import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRoute, type RoutingGraphData } from "./pathfinding";
import { routeToGeoJSON } from "./routeGeometry";

const graphPath = path.resolve(__dirname, "../../public/data/routing-graph.json");
const rawJson = fs.readFileSync(graphPath, "utf-8");
const testGraphData = JSON.parse(rawJson) as RoutingGraphData;

describe("Route Geometry Converter", () => {
  it("converts intra-floor route into 3D MultiPolygon ribbons and start/dest markers", () => {
    const route = findRoute(testGraphData, "N304", "N302");
    expect(route).not.toBeNull();
    const geojson = routeToGeoJSON(route);

    expect(geojson.ribbons.features.length).toBeGreaterThan(0);
    const ribbon = geojson.ribbons.features[0];
    expect(ribbon.geometry.type).toBe("MultiPolygon");
    expect(ribbon.properties.building).toBe("N");
    expect(ribbon.properties.level).toBe(3);
    expect(ribbon.properties.base).toBeCloseTo(7.08, 1);
    expect(ribbon.properties.height).toBeCloseTo(7.2, 1);

    expect(geojson.markers.features.length).toBe(2); // start and destination
    expect(geojson.markers.features[0].properties.kind).toBe("start");
    expect(geojson.markers.features[0].properties.label).toBe("N304");
    expect(geojson.markers.features[1].properties.kind).toBe("destination");
    expect(geojson.markers.features[1].properties.label).toBe("N302");
  });

  it("converts multi-floor route with transitions and correct elevations", () => {
    const route = findRoute(testGraphData, "N304", "N510");
    expect(route).not.toBeNull();
    const geojson = routeToGeoJSON(route);

    expect(geojson.ribbons.features.length).toBeGreaterThanOrEqual(2);
    const levels = new Set(geojson.ribbons.features.map((f) => f.properties.level));
    expect(levels.has(3)).toBe(true);
    expect(levels.has(5)).toBe(true);

    const transitionMarker = geojson.markers.features.find(
      (m) => m.properties.kind === "stairs" || m.properties.kind === "elevator"
    );
    expect(transitionMarker).toBeDefined();
  });

  it("handles null route cleanly", () => {
    const geojson = routeToGeoJSON(null);
    expect(geojson.ribbons.features.length).toBe(0);
    expect(geojson.markers.features.length).toBe(0);
  });
});
