import type { MultiPolygon, Polygon as PolygonGeometry } from "geojson";
import type { SkySpecification } from "maplibre-gl";
import { STOREY_HEIGHT } from "./campusLevels";

export type TimeOfDay = "day" | "golden" | "night";
export type Weather = "clear" | "rain" | "snow";
export type Season = "spring" | "summer" | "autumn" | "winter";

export type SceneStyle = {
  /** MapLibre light: position is [radial, azimuth°, polar°], polar 90 = sun on the horizon. */
  light: { position: [number, number, number]; color: string; intensity: number };
  sky: SkySpecification;
  facade: string;
  roof: string;
  neighbors: string;
  neighborOpacity: number;
  /** Night: Hunter's buildings show lit window bands instead of plain facades. */
  litWindows: boolean;
  /** CSS background layers drawn over the map for color grading. */
  overlay: string[];
};

const DAY: SceneStyle = {
  light: { position: [1.3, 210, 35], color: "#ffffff", intensity: 0.42 },
  sky: { "sky-color": "#c3d7ee", "horizon-color": "#eef1f4", "fog-color": "#f2f2f0", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.9, "atmosphere-blend": 0 },
  facade: "#7446ad",
  roof: "#e2d6f1",
  neighbors: "#e6e3dd",
  neighborOpacity: 0.4,
  litWindows: false,
  overlay: [],
};

const TIMES: Record<TimeOfDay, SceneStyle> = {
  day: DAY,
  golden: {
    ...DAY,
    light: { position: [1.3, 250, 65], color: "#ffe6cc", intensity: 0.45 },
    sky: { ...DAY.sky, "sky-color": "#f0a477", "horizon-color": "#ffd9a8", "fog-color": "#f7dcc0" },
    roof: "#f3d9c9",
    neighbors: "#ece3d8",
    overlay: ["linear-gradient(to bottom, rgba(255,140,60,.22), rgba(255,190,120,.06) 55%, transparent)"],
  },
  night: {
    ...DAY,
    light: { position: [1.3, 160, 40], color: "#9aaee0", intensity: 0.3 },
    sky: { ...DAY.sky, "sky-color": "#08102a", "horizon-color": "#1f2c52", "fog-color": "#151c30" },
    // Dark facades let the lit windows stand out.
    facade: "#3f2b68",
    roof: "#5d4890",
    neighbors: "#56627e",
    neighborOpacity: 0.45,
    litWindows: true,
    overlay: ["radial-gradient(ellipse at center, transparent 45%, rgba(4,8,22,.45))"],
  },
};

const WEATHER_SKY: Record<Exclude<Weather, "clear">, Partial<SkySpecification>> = {
  rain: { "sky-color": "#97a3b0", "horizon-color": "#c3cad2", "fog-color": "#c6ccd2" },
  snow: { "sky-color": "#cdd5de", "horizon-color": "#eef1f4", "fog-color": "#eceff2" },
};
const WEATHER_OVERLAY: Record<Exclude<Weather, "clear">, string> = {
  rain: "linear-gradient(rgba(60,72,88,.14), rgba(60,72,88,.14))",
  snow: "linear-gradient(rgba(255,255,255,.14), rgba(255,255,255,.14))",
};

/** Lighting, sky and colors for a time of day, with weather layered on top. */
export function sceneStyle(time: TimeOfDay, weather: Weather): SceneStyle {
  const base = TIMES[time];
  if (weather === "clear") return base;
  const night = time === "night";
  const snow = weather === "snow";
  return {
    ...base,
    light: { ...base.light, intensity: base.light.intensity * 0.7 },
    // Overcast skies only show by day; at night the dark sky stays.
    sky: night ? base.sky : { ...base.sky, ...WEATHER_SKY[weather] },
    roof: snow ? (night ? "#dfe6f5" : "#ffffff") : base.roof,
    neighbors: snow && !night ? "#f1f3f6" : base.neighbors,
    overlay: [WEATHER_OVERLAY[weather], ...base.overlay],
  };
}

/** Default time of day from the viewer's clock. */
// shortcut: fixed hours ignore the season's sunset time; use a sun-position calculation if that matters.
export function timeOfDayForHour(hour: number): TimeOfDay {
  if (hour >= 6 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "golden";
  return "night";
}

type BasemapColorProperty = "background-color" | "fill-color" | "fill-outline-color" | "line-color" | "text-color" | "text-halo-color";

/** Basemap paint properties the scenes recolor, by layer type. */
export const BASEMAP_COLOR_PROPERTIES: Record<string, BasemapColorProperty[]> = {
  background: ["background-color"],
  fill: ["fill-color", "fill-outline-color"],
  line: ["line-color"],
  symbol: ["text-color", "text-halo-color"],
};

type Palette = { background?: string; ground?: string; water?: string; green?: string; wood?: string; building?: string; buildingOutline?: string; road?: string; text?: [color: string, halo: string] };

const NIGHT: Palette = { background: "#161c2a", ground: "#1c2232", water: "#0d1524", building: "#252c3b", buildingOutline: "#2e3647", road: "#343d52", text: ["#a9b3c6", "#121826"] };

/** Default season from the month (0 = January). */
export function seasonForMonth(month: number): Season {
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

// Lawn and woodland colors for Central Park and other parks: [lawn, wood].
const PARKS: Record<Season, { day: [string, string]; night: [string, string] }> = {
  spring: { day: ["#d3e9bd", "#b6da9c"], night: ["#22322a", "#1f3424"] },
  summer: { day: ["#b6da9c", "#8cc173"], night: ["#1f3826", "#1a3320"] },
  autumn: { day: ["#ecd29a", "#e0a35c"], night: ["#3a3324", "#4a3420"] },
  winter: { day: ["#dedad0", "#cbc4b4"], night: ["#2a2d33", "#272a30"] },
};

/** Park colors for the season, time and weather; snow covers them in any season. */
export function parkColors(season: Season, time: TimeOfDay, weather: Weather): [lawn: string, wood: string] {
  if (weather === "snow") return time === "night" ? ["#2f3747", "#2b3342"] : ["#f3f6f8", "#e6ecee"];
  return PARKS[season][time === "night" ? "night" : "day"];
}

function basemapPalette(time: TimeOfDay, weather: Weather, season: Season): Palette {
  const [green, wood] = parkColors(season, time, weather);
  if (time === "night") {
    // Wet roads catch a bluish sheen; snow lightens the ground.
    if (weather === "rain") return { ...NIGHT, green, wood, background: "#131927", road: "#4d5b7c" };
    if (weather === "snow") return { ...NIGHT, green, wood, background: "#2a3141", ground: "#2a3141", building: "#333b4c", buildingOutline: "#3b4456", road: "#4a5368" };
    return { ...NIGHT, green, wood };
  }
  if (weather === "rain") return { green, wood, background: "#dde0e3", ground: "#d8dbde", building: "#cdd1d6", buildingOutline: "#c3c8cd", road: "#9ea7b1" };
  if (weather === "snow") return { green, wood, background: "#f6f8fa", ground: "#f1f4f7", building: "#e3e7eb", buildingOutline: "#d9dee3", road: "#d2d8de" };
  return { green, wood };
}

/** Scene colors for one basemap layer, by layer type and the OpenMapTiles naming of its id. Empty means keep the original. */
export function basemapPaint(id: string, type: string, time: TimeOfDay, weather: Weather, season: Season): [property: BasemapColorProperty, color: string][] {
  const palette = basemapPalette(time, weather, season);
  const pairs: [BasemapColorProperty, string | undefined][] =
    type === "background" ? [["background-color", palette.background]]
    : type === "fill" ? (
      /water/.test(id) ? [["fill-color", palette.water]]
      : /wood/.test(id) ? [["fill-color", palette.wood]]
      : /park|grass/.test(id) ? [["fill-color", palette.green]]
      : /building/.test(id) ? [["fill-color", palette.building], ["fill-outline-color", palette.buildingOutline]]
      : [["fill-color", palette.ground]]
    )
    : type === "line" ? [["line-color", /water|river/.test(id) ? palette.water : palette.road]]
    : type === "symbol" ? [["text-color", palette.text?.[0]], ["text-halo-color", palette.text?.[1]]]
    : [];
  return pairs.filter((pair): pair is [BasemapColorProperty, string] => pair[1] != null);
}

export type MassFeature = { geometry: PolygonGeometry | MultiPolygon; properties: { building: string; height: number } };
export type WindowFeature = {
  type: "Feature";
  id: number;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { building: string; glow: "bright" | "warm" | "dim"; base: number; height: number; lit: number };
};

const METERS_PER_DEGREE = 111320;
const WINDOW_SPACING_M = 3.2;
const WINDOW_SIZE_M = 1.4;
const WINDOW_SILL_M = 1;
// Windows sit just proud of the facade so they never flicker against it.
const WINDOW_OFFSET_M = 0.05;
const WINDOW_DEPTH_M = 0.2;
/** Share of windows lit on a floor, by how busy the floor is. */
export const LIT_SHARE = { bright: 0.8, warm: 0.55, dim: 0.25 } as const;

/**
 * Square windows on every facade of Hunter's buildings, one row per storey, for the night view.
 * Floors with more classrooms (relative to the building's busiest floor) have more windows lit.
 */
// shortcut: classroom counts stand in for "floors with classes"; use timetable data when the app has it.
export function hunterWindows(masses: MassFeature[], classrooms: Record<string, number>, random: () => number = Math.random) {
  const features: WindowFeature[] = [];
  for (const { geometry, properties: { building, height } } of masses) {
    const counts = Array.from({ length: Math.round(height / STOREY_HEIGHT) }, (_, k) => classrooms[`${building}:${k + 1}`] ?? 0);
    const busiest = Math.max(1, ...counts);
    const glows = counts.map((count) => (count >= busiest * 0.6 ? "bright" : count >= busiest * 0.25 ? "warm" : "dim") as WindowFeature["properties"]["glow"]);
    const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((polygon) => polygon[0]);
    for (const ring of rings) {
      const cosLat = Math.cos((ring[0][1] * Math.PI) / 180);
      const xy = ring.map(([lon, lat]) => [lon * METERS_PER_DEGREE * cosLat, lat * METERS_PER_DEGREE]);
      const toLngLat = ([x, y]: number[]) => [x / (METERS_PER_DEGREE * cosLat), y / METERS_PER_DEGREE];
      let area = 0;
      for (let i = 0; i < xy.length - 1; i++) area += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
      for (let i = 0; i < xy.length - 1; i++) {
        const [x1, y1] = xy[i];
        const [dx, dy] = [xy[i + 1][0] - x1, xy[i + 1][1] - y1];
        const length = Math.hypot(dx, dy);
        const count = Math.floor(length / WINDOW_SPACING_M);
        if (!count) continue;
        const [ux, uy] = [dx / length, dy / length];
        // Outward normal: right of the edge for counter-clockwise rings.
        const [nx, ny] = area > 0 ? [uy, -ux] : [-uy, ux];
        const corner = (along: number, out: number) => toLngLat([x1 + ux * along + nx * out, y1 + uy * along + ny * out]);
        const first = (length - count * WINDOW_SPACING_M) / 2 + WINDOW_SPACING_M / 2;
        glows.forEach((glow, storey) => {
          const base = storey * STOREY_HEIGHT + WINDOW_SILL_M;
          for (let j = 0; j < count; j++) {
            const [from, to] = [first + j * WINDOW_SPACING_M - WINDOW_SIZE_M / 2, first + j * WINDOW_SPACING_M + WINDOW_SIZE_M / 2];
            const [near, far] = [WINDOW_OFFSET_M, WINDOW_OFFSET_M + WINDOW_DEPTH_M];
            const start = corner(from, near);
            features.push({
              type: "Feature",
              id: features.length,
              geometry: { type: "Polygon", coordinates: [[start, corner(to, near), corner(to, far), corner(from, far), start]] },
              properties: { building, glow, base, height: base + WINDOW_SIZE_M, lit: random() < LIT_SHARE[glow] ? 1 : 0 },
            });
          }
        });
      }
    }
  }
  return { type: "FeatureCollection" as const, features };
}
