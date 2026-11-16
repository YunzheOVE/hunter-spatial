import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRoute, type RoutingGraphData } from "./pathfinding";
import { TOUR_STOPS, tourGraph } from "./tour";

const floorRooms = new Set(
  (JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data/hunter-floors.geojson"), "utf-8")) as { features: { properties: { kind: string; roomId?: string } }[] })
    .features.filter((feature) => feature.properties.kind === "room").map((feature) => feature.properties.roomId),
);
const graph = tourGraph(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data/routing-graph.json"), "utf-8")) as RoutingGraphData);

describe("first-week tour", () => {
  it("every stop is a room in the routing graph", () => {
    for (const stop of TOUR_STOPS) expect(graph.rooms[stop.roomId], stop.roomId).toBeDefined();
  });

  it("every stop except the skybridge anchor has a floor-plan room to zoom to", () => {
    for (const stop of TOUR_STOPS) if (!stop.roomId.startsWith("Skybridge")) expect(floorRooms.has(stop.roomId), stop.roomId).toBe(true);
  });

  it("every stop photo exists in public/", () => {
    for (const stop of TOUR_STOPS) if (stop.photo) expect(fs.existsSync(path.resolve(__dirname, "../../public", `.${stop.photo.src}`)), stop.photo.src).toBe(true);
  });

  // Main path skips detours; each detour is reached from the stop before it and returns to the next main stop.
  it.each([false, true])("every leg has an indoor route (step-free: %s)", (accessibleOnly) => {
    const main = TOUR_STOPS.filter((stop) => !stop.optional);
    const legs = main.slice(1).map((stop, i) => [main[i].roomId, stop.roomId]);
    TOUR_STOPS.forEach((stop, i) => {
      if (stop.optional) legs.push([TOUR_STOPS[i - 1].roomId, stop.roomId], [stop.roomId, TOUR_STOPS[i + 1].roomId]);
    });
    for (const [from, to] of legs) expect(findRoute(graph, from, to, { accessibleOnly }), `${from} → ${to}`).not.toBeNull();
  });
});
