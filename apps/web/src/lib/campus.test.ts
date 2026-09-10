import { describe, expect, it } from "vitest";
import {
  findRoom,
  getBuilding,
  getFloorView,
  listBuildings,
} from "./campus";

describe("campus catalog", () => {
  it("lists 68th Street buildings in stable order", () => {
    expect(listBuildings().map((b) => b.id)).toEqual(["N", "E", "W", "TH", "BTB"]);
  });

  it("finds a room and its door marker", () => {
    const room = findRoom("N304");
    expect(room?.buildingId).toBe("N");
    expect(room?.floor).toBe(3);
    expect(room?.doorPosition).toHaveLength(3);
  });

  it("resolves a scanned floor to the Polycam glTF URL", () => {
    const view = getFloorView("N", 3);
    expect(view.kind).toBe("scan");
    if (view.kind === "scan") {
      expect(view.scan.url).toBe("/models/floors/N/3-scan.glb");
      expect(view.scan.position[1]).toBeGreaterThan(0);
    }
  });

  it("resolves an unscanned floor to a plan view", () => {
    const view = getFloorView("E", 6);
    expect(view.kind).toBe("plan");
    expect(getBuilding("E")?.footprint.length).toBeGreaterThan(3);
  });

  it("throws when the building does not exist", () => {
    expect(() => getFloorView("ZZ", 1)).toThrow(/unknown building/i);
  });
});
