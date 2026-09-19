import { describe, expect, it } from "vitest";
import {
  campusBuildingsAtLevel,
  campusLevelsForSelection,
  campusPodiumLevels,
  closestCampusLevel,
} from "./campusLevels";

describe("campus level availability", () => {
  it("only includes buildings that have the selected campus level", () => {
    expect(campusBuildingsAtLevel(null, 18)).toEqual(["E", "W"]);
    expect(campusBuildingsAtLevel(null, 7)).toEqual(["N", "E", "W", "TH"]);
    expect(campusBuildingsAtLevel("BTB", 18)).toEqual([]);
  });

  it("only offers levels available in an isolated building", () => {
    expect(campusLevelsForSelection("BTB")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(campusLevelsForSelection("N")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("moves an isolated building selection to its nearest valid level", () => {
    expect(closestCampusLevel("BTB", 18)).toBe(6);
    expect(closestCampusLevel("BTB", 0)).toBe(1);
    expect(closestCampusLevel("N", 0)).toBe(0);
  });

  it("keeps shorter buildings as completed podium context", () => {
    expect(campusPodiumLevels(null, 18)).toEqual([
      ["N", 16],
      ["E", 17],
      ["W", 17],
      ["TH", 7],
      ["BTB", 6],
    ]);
  });
});
