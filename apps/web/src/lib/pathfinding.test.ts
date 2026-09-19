import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRoute, type RoutingGraphData } from "./pathfinding";

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
});
