import { describe, expect, it } from "vitest";
import { canonicalRoomId, parseRoomId } from "./parseRoomId";

describe("parseRoomId", () => {
  it("parses four-digit North rooms as floor then room", () => {
    expect(parseRoomId("N1516")).toEqual({
      id: "N1516",
      buildingId: "N",
      floor: 15,
      room: "16",
    });
  });

  it("parses three-digit East rooms", () => {
    expect(parseRoomId("E618")).toEqual({
      id: "E618",
      buildingId: "E",
      floor: 6,
      room: "18",
    });
  });

  it("parses Thomas Hunter and Baker Theatre prefixes", () => {
    expect(parseRoomId("TH412").buildingId).toBe("TH");
    expect(parseRoomId("TH412").floor).toBe(4);
    expect(parseRoomId("BTB620").buildingId).toBe("BTB");
    expect(parseRoomId("BTB620").floor).toBe(6);
  });

  it("maps cellar, east-basement, BTB concourse and TH basement to floor 0", () => {
    expect(parseRoomId("C111")).toEqual({
      id: "C111",
      buildingId: "N",
      floor: 0,
      room: "111",
    });
    expect(parseRoomId("EB121").buildingId).toBe("E");
    expect(parseRoomId("EB121").floor).toBe(0);
    expect(parseRoomId("BTBC01")).toEqual({
      id: "BTBC01",
      buildingId: "BTB",
      floor: 0,
      room: "C01",
    });
    expect(parseRoomId("THB004")).toEqual({
      id: "THB004",
      buildingId: "TH",
      floor: 0,
      room: "B004",
    });
  });

  it("normalizes HN/HW/HE to N/W/E", () => {
    expect(parseRoomId("HN433").buildingId).toBe("N");
    expect(parseRoomId("HW417").buildingId).toBe("W");
    expect(parseRoomId("HE405").buildingId).toBe("E");
  });

  it("keeps a trailing letter on the room token", () => {
    expect(parseRoomId("E1214B")).toEqual({
      id: "E1214B",
      buildingId: "E",
      floor: 12,
      room: "14B",
    });
  });

  it("rejects unknown prefixes", () => {
    expect(() => parseRoomId("Z100")).toThrow(/unknown building prefix/i);
  });

  it("canonicalizes HN/HW codes to the map room id", () => {
    expect(canonicalRoomId(parseRoomId("HN304"))).toBe("N304");
    expect(canonicalRoomId(parseRoomId("N304"))).toBe("N304");
    expect(canonicalRoomId(parseRoomId("HW417"))).toBe("W417");
  });

  it("keeps cellar codes when floor is 0", () => {
    expect(canonicalRoomId(parseRoomId("C111"))).toBe("C111");
  });
});
