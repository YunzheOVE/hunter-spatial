import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRoute, resolveRoom, type RoutingGraphData } from "./pathfinding";

const graphPath = path.resolve(__dirname, "../../public/data/routing-graph.json");
const rawJson = fs.readFileSync(graphPath, "utf-8");
const testGraphData = JSON.parse(rawJson) as RoutingGraphData;

describe("Client-side Pathfinding Engine", () => {
  it("computes intra-floor path between rooms on the same floor", () => {
    const route = findRoute(testGraphData, "N304", "N302");
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route.fromRoom).toBe("N304");
    expect(route.toRoom).toBe("N302");
    expect(route.totalDistanceMeters).toBeGreaterThan(15);
    expect(route.totalDistanceMeters).toBeLessThan(70);
    expect(route.legs.length).toBe(1);
    expect(route.legs[0].building).toBe("N");
    expect(route.legs[0].level).toBe(3);
    expect(route.transitions.length).toBe(0);
  });

  it("computes cross-building path across Level 3 Lexington Skybridge", () => {
    // West Building Level 3 to East Building Level 3
    const route = findRoute(testGraphData, "W305", "E303");
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route.fromRoom).toBe("W305");
    expect(route.toRoom).toBe("E303");
    expect(route.totalDistanceMeters).toBeGreaterThan(50);

    const visitedBuildings = new Set(route.legs.map((l) => l.building));
    expect(visitedBuildings.has("W")).toBe(true);
    expect(visitedBuildings.has("E")).toBe(true);

    const bridgeTransition = route.transitions.find((t) => t.type === "bridge");
    expect(bridgeTransition).toBeDefined();
    expect(bridgeTransition?.fromLevel).toBe(3);
    expect(bridgeTransition?.toLevel).toBe(3);
  });

  it("computes multi-floor path between Level 3 and Level 5", () => {
    const route = findRoute(testGraphData, "N304", "N510");
    expect(route).not.toBeNull();
    if (!route) return;

    const visitedLevels = new Set(route.legs.map((l) => l.level));
    expect(visitedLevels.has(3)).toBe(true);
    expect(visitedLevels.has(5)).toBe(true);
    expect(route.transitions.length).toBeGreaterThan(0);
  });

  it("computes accessible route avoiding stairs", () => {
    const route = findRoute(testGraphData, "N304", "N510", { accessibleOnly: true });
    expect(route).not.toBeNull();
    if (!route) return;

    for (const transition of route.transitions) {
      expect(transition.type).not.toBe("stairs");
      expect(transition.type).not.toBe("escalator");
    }
  });

  it("handles identical start and destination gracefully", () => {
    const route = findRoute(testGraphData, "N304", "N304");
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route.totalDistanceMeters).toBe(0);
    expect(route.estimatedSeconds).toBe(0);
    expect(route.legs.length).toBe(1);
    expect(route.transitions.length).toBe(0);
  });

  it("returns null for non-existent rooms", () => {
    const route = findRoute(testGraphData, "NON_EXISTENT_123", "N304");
    expect(route).toBeNull();
  });

  it("resolves rooms flexibly with case insensitivity and normalized prefixes", () => {
    const resolvedLower = findRoute(testGraphData, "w305", "e303");
    expect(resolvedLower).not.toBeNull();
    expect(resolvedLower?.fromRoom).toBe("W305");
    expect(resolvedLower?.toRoom).toBe("E303");

    const resolvedPrefix = findRoute(testGraphData, "HW-305", "HE-303");
    expect(resolvedPrefix).not.toBeNull();
    expect(resolvedPrefix?.fromRoom).toBe("W305");
    expect(resolvedPrefix?.toRoom).toBe("E303");
  });

  it("avoids cutting through intermediate private classrooms like W131", () => {
    const route = findRoute(testGraphData, "W113", "W119");
    expect(route).not.toBeNull();
    if (!route) return;

    const w131NodeId = testGraphData.rooms["W131"]?.nodeId;
    expect(w131NodeId).toBeDefined();
    // Route must not contain W131's node as an intermediate shortcut
    expect(route.nodePath).not.toContain(w131NodeId);
  });

  it("routes to suite destination rooms that require entering an outer suite room", () => {
    const route = findRoute(testGraphData, "W116", "W125A");
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route.fromRoom).toBe("W116");
    expect(route.toRoom).toBe("W125A");
    expect(route.nodePath[route.nodePath.length - 1]).toBe(testGraphData.rooms["W125A"].nodeId);
  });

  it("strictly routes indoors between campus buildings via Level 3 skybridges (W117 -> TH114)", () => {
    const route = findRoute(testGraphData, "W117", "TH114");
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route.fromRoom).toBe("W117");
    expect(route.toRoom).toBe("TH114");

    // All legs must belong to indoor buildings (never outdoor/empty)
    for (const leg of route.legs) {
      expect(["W", "N", "TH", "E", "BTB"]).toContain(leg.building);
      expect(leg.building).not.toBe("");
    }

    // Must visit Level 3 to use the campus skybridge network
    const visitedLevels = new Set(route.legs.map((l) => l.level));
    expect(visitedLevels.has(3)).toBe(true);

    // Transitions must include vertical transit to L3, skybridge crossings, and descent to L1
    const transitionTypes = route.transitions.map((t) => t.type);
    expect(transitionTypes).toContain("bridge");
    expect(transitionTypes.some((t) => t === "elevator" || t === "stairs")).toBe(true);

    // No transition should have an empty building or outdoor exit
    for (const tr of route.transitions) {
      expect(tr.fromBuilding).not.toBe("");
      expect(tr.toBuilding).not.toBe("");
      expect(tr.description).not.toContain("Building  Building");
      expect(tr.description).not.toContain("Skybridge from W to  Building");
    }

    // Verify first leg starts in West Building Level 1 and last leg ends in Thomas Hunter Level 1
    expect(route.legs[0].building).toBe("W");
    expect(route.legs[0].level).toBe(1);
    expect(route.legs[route.legs.length - 1].building).toBe("TH");
    expect(route.legs[route.legs.length - 1].level).toBe(1);
  });

  it("connects cross-building skybridges seamlessly with zero coordinate gap (N1021 -> W1037)", () => {
    const route = findRoute(testGraphData, "N1021", "W1037", { accessibleOnly: true });
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route.fromRoom).toBe("N1021");
    expect(route.toRoom).toBe("W1037");

    // Find the bridge transition
    const bridgeTrIndex = route.transitions.findIndex((t) => t.type === "bridge");
    expect(bridgeTrIndex).toBeGreaterThanOrEqual(0);
    const bridgeTr = route.transitions[bridgeTrIndex];
    expect(bridgeTr.fromBuilding).toBe("N");
    expect(bridgeTr.toBuilding).toBe("W");
    expect(bridgeTr.fromLevel).toBe(3);
    expect(bridgeTr.toLevel).toBe(3);
    expect(bridgeTr.distanceMeters).toBeGreaterThan(15);
    expect(bridgeTr.toLocation).toBeDefined();

    // The leg before the bridge transition must end at the bridge destination coordinate
    const legBeforeBridge = route.legs[bridgeTrIndex];
    const legAfterBridge = route.legs[bridgeTrIndex + 1];

    const outgoingBridgeEnd = legBeforeBridge.coordinates[legBeforeBridge.coordinates.length - 1];
    const incomingBridgeStart = legAfterBridge.coordinates[0];

    // Must be exactly identical coordinates with zero gap
    expect(outgoingBridgeEnd).toEqual(incomingBridgeStart);
    expect(outgoingBridgeEnd).toEqual(bridgeTr.toLocation);
  });

  describe("Facility / Washroom Resolution & Routing", () => {
    it("resolves specific washroom codes and short aliases", () => {
      expect(resolveRoom(testGraphData, "N9-MEN")?.roomId).toBe("N9-MEN");
      expect(resolveRoom(testGraphData, "N10-WOMEN")?.roomId).toBe("N10-WOMEN");
      expect(resolveRoom(testGraphData, "W3-MEN")?.roomId).toBe("W3-MEN");
      expect(resolveRoom(testGraphData, "n9m")?.roomId).toBe("N9-MEN");
      expect(resolveRoom(testGraphData, "N10W")?.roomId).toBe("N10-WOMEN");
      expect(resolveRoom(testGraphData, "N9MEN")?.roomId).toBe("N9-MEN");
    });

    it("resolves natural language washroom queries to the closest floor when alternating", () => {
      // North 10 has a women's washroom (N10-WOMEN), so men's query resolves to nearest floor N9-MEN
      const menNorth10 = resolveRoom(testGraphData, "men's washroom at north 10th floor");
      expect(menNorth10).not.toBeNull();
      expect(menNorth10?.roomId).toBe("N9-MEN");
      expect(menNorth10?.room.building).toBe("N");
      expect(menNorth10?.room.level).toBe(9);

      // Generic washroom at North 10 resolves to the women's washroom on floor 10
      const washroomNorth10 = resolveRoom(testGraphData, "washroom at north 10th floor");
      expect(washroomNorth10).not.toBeNull();
      expect(washroomNorth10?.roomId).toBe("N10-WOMEN");
      expect(washroomNorth10?.room.level).toBe(10);

      // Women's washroom at North 10 resolves to N10-WOMEN
      const womenNorth10 = resolveRoom(testGraphData, "women's washroom north 10th floor");
      expect(womenNorth10?.roomId).toBe("N10-WOMEN");
    });

    it("routes from W304 to North washroom via skybridge into North building, never back to West L1", () => {
      // User's exact reported bug scenario
      const route = findRoute(testGraphData, "w304", "men's washroom at north 10th floor");
      expect(route).not.toBeNull();
      if (!route) return;

      expect(route.fromRoom).toBe("W304");
      expect(route.toRoom).toBe("N9-MEN");

      // Verify visited buildings: starts in W, crosses to N
      const visitedBuildings = new Set(route.legs.map((l) => l.building));
      expect(visitedBuildings.has("W")).toBe(true);
      expect(visitedBuildings.has("N")).toBe(true);

      // It must NEVER route down to West Building Level 1
      const westLevels = route.legs.filter((l) => l.building === "W").map((l) => l.level);
      expect(westLevels).not.toContain(1);

      // The final leg must end in North Building on Level 9
      const lastLeg = route.legs[route.legs.length - 1];
      expect(lastLeg.building).toBe("N");
      expect(lastLeg.level).toBe(9);

      // Verify bridge transition from West Level 3 to North Level 3
      const bridgeTr = route.transitions.find((t) => t.type === "bridge");
      expect(bridgeTr).toBeDefined();
      expect(bridgeTr?.fromBuilding).toBe("W");
      expect(bridgeTr?.toBuilding).toBe("N");
    });

    it("routes from W304 to N10-WOMEN directly to North Level 10", () => {
      const route = findRoute(testGraphData, "W304", "washroom at north 10th floor");
      expect(route).not.toBeNull();
      if (!route) return;

      expect(route.fromRoom).toBe("W304");
      expect(route.toRoom).toBe("N10-WOMEN");

      const lastLeg = route.legs[route.legs.length - 1];
      expect(lastLeg.building).toBe("N");
      expect(lastLeg.level).toBe(10);
    });
  });
});
