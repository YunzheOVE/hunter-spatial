import { describe, expect, it } from "vitest";
import { basemapPaint, hunterWindows, parkColors, sceneStyle, seasonForMonth, timeOfDayForHour } from "./mapScene";

describe("map scene", () => {
  it("picks a time of day from the clock", () => {
    expect(timeOfDayForHour(5)).toBe("night");
    expect(timeOfDayForHour(6)).toBe("day");
    expect(timeOfDayForHour(16)).toBe("golden");
    expect(timeOfDayForHour(19)).toBe("night");
  });

  it("layers weather over the time of day", () => {
    expect(sceneStyle("day", "clear")).toBe(sceneStyle("day", "clear"));
    expect(sceneStyle("day", "snow").roof).toBe("#ffffff");
    expect(sceneStyle("day", "rain").sky["sky-color"]).toBe("#97a3b0");
    // Night keeps its dark sky and lit windows in any weather.
    expect(sceneStyle("night", "rain").sky["sky-color"]).toBe(sceneStyle("night", "clear").sky["sky-color"]);
    expect(sceneStyle("night", "snow").litWindows).toBe(true);
    expect(sceneStyle("day", "clear").litWindows).toBe(false);
    expect(sceneStyle("golden", "rain").overlay).toHaveLength(2);
  });

  it("keeps neighbor buildings see-through", () => {
    for (const time of ["day", "golden", "night"] as const) {
      expect(sceneStyle(time, "clear").neighborOpacity).toBeLessThan(0.7);
    }
  });

  it("recolors the basemap for night, wet roads, snowy ground and the season's parks", () => {
    expect(basemapPaint("road_minor", "line", "day", "clear", "summer")).toEqual([]);
    expect(basemapPaint("water", "fill", "night", "clear", "summer")).toEqual([["fill-color", "#0d1524"]]);
    expect(basemapPaint("road_minor", "line", "night", "rain", "summer")).toEqual([["line-color", "#4d5b7c"]]);
    expect(basemapPaint("landuse_residential", "fill", "day", "snow", "summer")).toEqual([["fill-color", "#f1f4f7"]]);
    expect(basemapPaint("park", "fill", "day", "clear", "autumn")).toEqual([["fill-color", "#ecd29a"]]);
    expect(basemapPaint("landcover_wood", "fill", "day", "clear", "autumn")).toEqual([["fill-color", "#e0a35c"]]);
    // Daytime weather leaves labels and water alone.
    expect(basemapPaint("place_label", "symbol", "day", "rain", "summer")).toEqual([]);
    expect(basemapPaint("water", "fill", "day", "snow", "summer")).toEqual([]);
    expect(basemapPaint("hillshade", "raster", "night", "clear", "summer")).toEqual([]);
  });
});

const square = (size: number): [number, number][] => {
  const d = size / 111320;
  return [[0, 0], [d, 0], [d, d], [0, d], [0, 0]];
};

describe("lit windows", () => {
  it("puts a row of square windows on every facade per storey, just outside the walls", () => {
    const { features } = hunterWindows(
      [{ geometry: { type: "Polygon", coordinates: [square(10)] }, properties: { building: "TH", height: 7 } }],
      { "TH:1": 10, "TH:2": 1 },
      () => 0,
    );
    // 10 m walls fit 3 windows each: 4 walls x 3 windows x 2 storeys.
    expect(features).toHaveLength(24);
    expect(new Set(features.map((feature) => feature.id)).size).toBe(24);
    const [window] = features;
    expect(window.properties.height - window.properties.base).toBeCloseTo(1.4);
    expect(features.every((feature) => feature.properties.lit === 1)).toBe(true);
    // The south wall's windows sit just south of the building.
    const south = features.filter((feature) => feature.geometry.coordinates[0].every(([, lat]) => lat < 0));
    expect(south).toHaveLength(6);
    expect(features.map((feature) => feature.properties.glow)).toContain("dim");
  });
});

describe("seasonal parks", () => {
  it("picks the season from the month and colors parks for it", () => {
    expect(seasonForMonth(10)).toBe("autumn");
    expect(seasonForMonth(0)).toBe("winter");
    expect(seasonForMonth(3)).toBe("spring");
    expect(parkColors("summer", "day", "clear")).toEqual(["#b6da9c", "#8cc173"]);
    expect(parkColors("summer", "day", "snow")[0]).toBe("#f3f6f8");
  });
});
