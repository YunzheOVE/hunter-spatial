"use client";

import { LngLat, Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, PaddingOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import {
  campusBuildingsAtLevel,
  campusPodiumLevels,
  CAMPUS_TOP_FLOORS,
  type CampusBuildingId,
  STOREY_HEIGHT,
} from "@/lib/campusLevels";
import type { RouteResult } from "@/lib/pathfinding";
import { routeToGeoJSON } from "@/lib/routeGeometry";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type Props = {
  buildingId: CampusBuildingId | null;
  floor: number | null;
  panelOpen: boolean;
  selectedRoom: string | null;
  onSelectRoom: (roomId: string) => void;
  activeRoute?: RouteResult | null;
  activeLegIndex?: number | null;
  directionMode?: boolean;
};

type FloorProps = {
  id: string;
  roomId: string;
  kind: string;
  scope: string;
  building: string;
  level: number | null;
  base: number;
  height: number;
};
type FloorFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: FloorProps;
};

function bboxOfMany(features: FloorFeature[]): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === "number") {
      minX = Math.min(minX, value[0] as number);
      minY = Math.min(minY, value[1] as number);
      maxX = Math.max(maxX, value[0] as number);
      maxY = Math.max(maxY, value[1] as number);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

function isCampusBuildingId(value: string): value is CampusBuildingId {
  return value in CAMPUS_TOP_FLOORS;
}

function indoorFilter(
  kind: string,
  floor: number | null,
  buildingId: CampusBuildingId | null,
): FilterSpecification {
  if (floor === null) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  const buildingLevels = campusBuildingsAtLevel(buildingId, floor).map((building) => [
    "all",
    ["==", ["get", "building"], building],
    ["==", ["get", "level"], floor],
  ]);
  if (!buildingLevels.length) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  return [
    "all",
    ["==", ["get", "kind"], kind],
    ["==", ["get", "scope"], "indoor"],
    ["any", ...buildingLevels],
  ] as unknown as FilterSpecification;
}

function stackedPodiumFilter(
  floor: number | null,
  buildingId: CampusBuildingId | null,
): FilterSpecification {
  if (floor === null) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  const buildingLevels = campusPodiumLevels(buildingId, floor).map(([building, topLevel]) => [
    "all",
    ["==", ["get", "building"], building],
    ["<=", ["get", "level"], topLevel],
  ]);
  if (!buildingLevels.length) return ["==", ["get", "kind"], "__hidden__"] as FilterSpecification;
  return [
    "all",
    ["==", ["get", "kind"], "floor"],
    ["==", ["get", "scope"], "indoor"],
    [">=", ["get", "level"], 1],
    ["any", ...buildingLevels],
  ] as unknown as FilterSpecification;
}

function isVisibleFloor(
  feature: FloorFeature,
  floor: number,
  buildingId: CampusBuildingId | null,
): boolean {
  const { building, kind, level } = feature.properties;
  return kind === "floor"
    && isCampusBuildingId(building)
    && level === floor
    && campusBuildingsAtLevel(buildingId, floor).includes(building);
}

function hasWebGL2(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2"));
}

function bboxOfCoords(coords: [number, number][]): [number, number, number, number] | null {
  if (coords.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

// Keep camera targets clear of the overlay: left panel on desktop, bottom sheet on phones, floor picker on the right.
function cameraPadding(map: MapLibreMap, panelOpen: boolean) {
  const { clientWidth, clientHeight } = map.getContainer();
  if (clientWidth < 768) return { top: 90, right: 72, bottom: Math.round(clientHeight * 0.45), left: 24 };
  return panelOpen
    ? { top: 90, right: 96, bottom: 90, left: 440 }
    : { top: 150, right: 96, bottom: 120, left: 80 };
}

const CAMERA_BEARING = -20;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
const METERS_PER_DEGREE = 111320;

function levelHeight(level: number) {
  return Math.max(0, (level - 1) * STOREY_HEIGHT);
}

// fitBounds frames the ground, but upper floors sit up to ~65 m above it. For a camera tilted by `pitch`, a point
// h metres up lies on the view axis when the ground centre moves h·tan(pitch) forward, and it is h/cos(pitch)
// closer to the camera, so zoom out by that ratio to keep the intended framing.
function fitElevated(
  map: MapLibreMap,
  box: [number, number, number, number],
  heightMeters: number,
  pitch: number,
  padding: PaddingOptions,
  maxZoom: number,
) {
  const target = map.cameraForBounds(box, { padding, pitch, bearing: CAMERA_BEARING, maxZoom });
  if (!target?.center || target.zoom === undefined) return;
  const center = LngLat.convert(target.center);
  const tilt = (pitch * Math.PI) / 180;
  const heading = (CAMERA_BEARING * Math.PI) / 180;
  const latitude = (center.lat * Math.PI) / 180;
  const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(latitude)) / (512 * 2 ** target.zoom);
  const cameraMeters = (0.5 / Math.tan((map.getVerticalFieldOfView() * Math.PI) / 360)) * map.getCanvas().clientHeight * metersPerPixel;
  const forward = heightMeters * Math.tan(tilt);
  map.easeTo({
    center: [
      center.lng + (forward * Math.sin(heading)) / (METERS_PER_DEGREE * Math.cos(latitude)),
      center.lat + (forward * Math.cos(heading)) / METERS_PER_DEGREE,
    ],
    zoom: target.zoom - Math.log2(1 + heightMeters / (Math.cos(tilt) * cameraMeters)),
    pitch,
    bearing: CAMERA_BEARING,
    duration: 750,
  });
}

function fitRoom(map: MapLibreMap, data: FloorFeature[], roomId: string, level: number | null, panelOpen: boolean) {
  const room = data.filter((item) => item.properties.kind === "room" && item.properties.roomId === roomId && item.properties.level === level);
  const box = bboxOfMany(room);
  if (!box) return;
  fitElevated(map, box, room[0].properties.base ?? 0, 52, cameraPadding(map, panelOpen), 19.2);
}

function fitFeatures(
  map: MapLibreMap,
  data: FloorFeature[],
  floor: number | null,
  buildingId: CampusBuildingId | null,
  panelOpen: boolean,
  activeRoute?: RouteResult | null,
  activeLegIndex?: number | null,
  directionMode: boolean = false,
) {
  const indoor = floor != null;
  const effectiveBuildingId = directionMode ? null : buildingId;

  let targetBox: [number, number, number, number] | null = null;
  let isStepFocus = false;

  if (activeRoute && activeRoute.legs.length > 0) {
    // 1. Prioritize the currently active leg if activeLegIndex is specified
    const currentLeg =
      activeLegIndex != null && activeRoute.legs[activeLegIndex]
        ? activeRoute.legs[activeLegIndex]
        : null;

    if (currentLeg && currentLeg.coordinates.length > 0) {
      isStepFocus = true;
      const legBbox = bboxOfCoords(currentLeg.coordinates);
      if (legBbox) {
        const [minX, minY, maxX, maxY] = legBbox;
        // Pad by ~25m so camera frames the route segment closely with clear corridor context
        const minSpanLon = 0.00032; // ~25m
        const minSpanLat = 0.00022; // ~25m
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const halfSpanX = Math.max((maxX - minX) / 2 + 0.0001, minSpanLon);
        const halfSpanY = Math.max((maxY - minY) / 2 + 0.00008, minSpanLat);
        targetBox = [midX - halfSpanX, midY - halfSpanY, midX + halfSpanX, midY + halfSpanY];
      }
    } else {
      const floorLegs = activeRoute.legs.filter((l) => l.level === floor);
      if (floorLegs.length > 0) {
        const floorCoords = floorLegs.flatMap((l) => l.coordinates);
        if (floorCoords.length > 0) {
          targetBox = bboxOfCoords(floorCoords);
        }
      }
    }
  }

  const features =
    !indoor
      ? data.filter((item) => item.properties.kind === "mass")
      : effectiveBuildingId == null
        ? data.filter((item) => item.properties.kind === "floor")
        : data.filter((item) => isVisibleFloor(item, floor, effectiveBuildingId));
  const box = targetBox ?? bboxOfMany(features.length ? features : data);
  if (!box) return;
  const padding = cameraPadding(map, panelOpen);
  const pitch = indoor ? 52 : 48;
  const legLevel = activeLegIndex != null ? activeRoute?.legs[activeLegIndex]?.level : undefined;
  const elevation = indoor ? levelHeight(legLevel ?? floor) : 0;

  const targetMaxZoom = isStepFocus
    ? 19.6 // Zoom closely on the active route corridor so users see turns and doors clearly
    : activeRoute
      ? 18.5
      : indoor
        ? 18.2
        : 16.7;

  fitElevated(map, box, elevation, pitch, padding, targetMaxZoom);
}

// Icon paths on a 24px grid (Lucide-style strokes; restroom figures are filled pictograms).
const BADGE_ICONS: Record<string, [color: string, icon: string]> = {
  "badge-classroom": ["#1e293b", '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>'],
  "badge-lecture": ["#7c3aed", '<path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5"/>'],
  "badge-study": ["#d97706", '<path d="M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5"/>'],
  "badge-office": ["#475569", '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'],
  "badge-food": ["#ea580c", '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/>'],
  "badge-lounge": ["#b45309", '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0zM4 18v2M20 18v2"/>'],
  "badge-stairs": ["#2563eb", '<path d="M3 21h5v-5h5v-5h5V6h3"/>'],
  "badge-elevator": ["#2563eb", '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="m9 9 3-3 3 3M9 15l3 3 3-3"/>'],
  "badge-restroom-men": ["#2563eb", '<g fill="#fff" stroke="none"><circle cx="12" cy="4.5" r="2.3"/><path d="M9.5 8.5h5a1.5 1.5 0 0 1 1.5 1.5v5.5h-2v6.5h-4v-6.5H8V10a1.5 1.5 0 0 1 1.5-1.5z"/></g>'],
  "badge-restroom-women": ["#ec4899", '<g fill="#fff" stroke="none"><circle cx="12" cy="4.5" r="2.3"/><path d="M10 8.5h4l3 8h-3v5.5h-4v-5.5H7z"/></g>'],
  "badge-restroom": ["#15803d", '<g fill="#fff" stroke="none"><circle cx="7.5" cy="4.5" r="2"/><path d="M5.5 8h4a1 1 0 0 1 1 1v5h-1.5v7h-3v-7H4.5V9a1 1 0 0 1 1-1z"/><circle cx="16.5" cy="4.5" r="2"/><path d="M15 8h3l2.5 7H18v6h-3v-6h-2.5z"/></g>'],
};

function badgeSvg(color: string, icon: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-opacity=".3"/></filter></defs><circle cx="32" cy="32" r="27" fill="#fff" filter="url(#s)"/><circle cx="32" cy="32" r="24" fill="${color}"/><g transform="translate(18 18) scale(1.1667)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`;
}

// Classrooms show as small dots until zoomed in, so amenities stand out.
const CLASSROOM_DOT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="11" fill="#fff"/><circle cx="32" cy="32" r="7.5" fill="#1e293b"/></svg>';

async function addSvgImage(map: MapLibreMap, id: string, svg: string) {
  if (map.hasImage(id)) return;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
}

async function registerCustomBadges(map: MapLibreMap) {
  await Promise.all([
    ...Object.entries(BADGE_ICONS).map(([id, [color, icon]]) => addSvgImage(map, id, badgeSvg(color, icon))),
    addSvgImage(map, "dot-classroom", CLASSROOM_DOT_SVG),
  ]);
}

/** Badge per marker; classroom-category rooms named like lounges or cafés get the food & lounge icons. */
function markerIcon(classroomIcon: string): ExpressionSpecification {
  const name = ["downcase", ["coalesce", ["get", "name"], ""]] as ExpressionSpecification;
  return [
    "case",
    ["==", ["get", "category"], "classroom"],
    ["case", ["in", "lounge", name], "badge-lounge", ["any", ["in", "caf", name], ["in", "dining", name]], "badge-food", classroomIcon],
    ["coalesce", ["get", "iconBadge"], "badge-classroom"],
  ];
}

async function registerRouteMarkerIcons(map: MapLibreMap) {
  for (const [id, url] of [
    ["route-start", "/icons/route-start.svg"],
    ["route-destination", "/icons/route-destination.svg"],
  ] as const) {
    if (map.hasImage(id)) continue;
    const image = new Image();
    image.src = url;
    await image.decode();
    map.addImage(id, image, { pixelRatio: 2 });
  }
}

function roomColor(selectedRoom: string | null): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "roomId"], selectedRoom ?? ""],
    "#10b981",
    ["coalesce", ["get", "color"], "#ffffff"],
  ];
}

const HUNTER_FACADE = "#7446ad";
const HUNTER_ROOF = "#e2d6f1";

// Basemap (OpenMapTiles) copies of Hunter's own buildings; excluded so they don't z-fight with the campus masses.
// shortcut: ids found by matching basemap footprints to hunter-floors.geojson masses; recheck if the basemap or campus data changes.
const BASEMAP_HUNTER_IDS = [1081114240, 2653453830, 2668640830, 2668865400, 36068380];

// Level matters: some basement rooms share a room id with an upper floor (WB406 is stored as W406 on level -4).
function selectedRoomFilter(roomId: string | null, level: number | null): FilterSpecification {
  return ["all", ["==", ["get", "kind"], "room"], ["==", ["get", "roomId"], roomId ?? "__none__"], ["==", ["get", "level"], level ?? 1]];
}

function hideBasemapExtrusions(map: MapLibreMap) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === "fill-extrusion") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

function setMode(
  map: MapLibreMap,
  floor: number | null,
  buildingId: CampusBuildingId | null,
  directionMode: boolean = false,
) {
  const indoor = floor != null;
  for (const id of [
    "stacked-podiums",
    "floor-plate",
    "hallways",
    "rooms",
    "room-outlines",
    "walls",
    "campus-room-labels",
    "route-ribbons",
    "route-markers-label",
    "room-selected-glow",
    "room-selected-beam",
    "room-selected-label",
  ]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", indoor ? "visible" : "none");
    }
  }
  // Neighbors would hide floor plates indoors, so the city context is outdoor-only.
  for (const id of ["campus-flat", "building-labels", "hunter-mass", "hunter-roofs", "context-buildings"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", indoor ? "none" : "visible");
  }

  // Skybridges connect campus buildings at Level 3.
  // - Outdoors (floor == null): 3D purple exterior mass (height 9.6m, color #5b238a)
  // - Level 3 indoors (floor === 3): flat walkway plate (height 7.06m, color #d8dde4) so route ribbons on top are completely unobstructed
  // - Other indoor floors (floor !== 3): hidden completely so they do not hover in mid-air or obstruct other floors
  if (map.getLayer("hunter-bridges")) {
    const isLevel3 = floor === 3;
    const showBridges = !indoor || isLevel3;
    map.setLayoutProperty("hunter-bridges", "visibility", showBridges ? "visible" : "none");

    if (showBridges) {
      if (!indoor) {
        map.setPaintProperty("hunter-bridges", "fill-extrusion-base", 7.0);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-height", 9.6);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-color", HUNTER_FACADE);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-opacity", 1.0);
      } else {
        map.setPaintProperty("hunter-bridges", "fill-extrusion-base", 7.0);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-height", 7.06);
        map.setPaintProperty("hunter-bridges", "fill-extrusion-color", "#d8dde4");
        map.setPaintProperty("hunter-bridges", "fill-extrusion-opacity", 1.0);
      }
    }
  }

  if (!indoor) {
    map.setFilter("hunter-mass", ["==", ["get", "kind"], "mass"]);
    map.setPaintProperty("hunter-mass", "fill-extrusion-base", 0);
    map.setPaintProperty("hunter-mass", "fill-extrusion-height", ["get", "height"]);
    map.setPaintProperty("hunter-mass", "fill-extrusion-color", HUNTER_FACADE);
    if (map.getLayer("campus-room-labels")) map.setFilter("campus-room-labels", ["==", ["get", "id"], ""]);
    if (map.getLayer("route-ribbons")) map.setFilter("route-ribbons", ["==", ["get", "id"], ""]);
    if (map.getLayer("route-markers-label")) map.setFilter("route-markers-label", ["==", ["get", "id"], ""]);
    return;
  }

  // In direction mode (or when a route is active), ALWAYS keep all buildings visible
  const effectiveBuildingId = directionMode ? null : buildingId;

  map.setFilter("stacked-podiums", stackedPodiumFilter(floor, effectiveBuildingId));
  map.setFilter("floor-plate", indoorFilter("floor", floor, effectiveBuildingId));
  map.setFilter("hallways", indoorFilter("hallway", floor, effectiveBuildingId));
  map.setFilter("rooms", indoorFilter("room", floor, effectiveBuildingId));
  if (map.getLayer("room-outlines")) {
    map.setFilter("room-outlines", indoorFilter("room-outline", floor, effectiveBuildingId));
  }
  map.setFilter("walls", indoorFilter("wall", floor, effectiveBuildingId));

  const markerFilter = (
    effectiveBuildingId == null
      ? ["==", ["get", "level"], floor]
      : ["all", ["==", ["get", "level"], floor], ["==", ["get", "building"], effectiveBuildingId]]
  ) as FilterSpecification;

  if (map.getLayer("campus-room-labels")) map.setFilter("campus-room-labels", markerFilter);

  const routeFilter: FilterSpecification = [
    "any",
    ["==", ["get", "level"], floor],
    ["==", ["get", "toLevel"], floor],
  ] as unknown as FilterSpecification;

  if (map.getLayer("route-ribbons")) map.setFilter("route-ribbons", routeFilter);
  if (map.getLayer("route-markers-label")) map.setFilter("route-markers-label", routeFilter);
}

export function MapView({
  buildingId,
  floor,
  panelOpen,
  selectedRoom,
  onSelectRoom,
  activeRoute,
  activeLegIndex,
  directionMode = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRoomRef = useRef(onSelectRoom);
  const floorRef = useRef(floor);
  const panelOpenRef = useRef(panelOpen);
  const buildingIdRef = useRef(buildingId);
  const activeRouteRef = useRef(activeRoute);
  const activeLegIndexRef = useRef(activeLegIndex);
  const directionModeRef = useRef(directionMode);
  const dataRef = useRef<FloorFeature[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading campus map…");
  onSelectRoomRef.current = onSelectRoom;
  floorRef.current = floor;
  panelOpenRef.current = panelOpen;
  buildingIdRef.current = buildingId;
  activeRouteRef.current = activeRoute;
  activeLegIndexRef.current = activeLegIndex;
  directionModeRef.current = directionMode;

  useEffect(() => {
    if (!rootRef.current || mapRef.current) return;
    if (!hasWebGL2()) {
      setStatus("This browser cannot draw the map. Open http://localhost:3000 in Chrome or Edge.");
      return;
    }

    const map = new MapLibreMap({
      container: rootRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-73.9646, 40.7685],
      zoom: 16.6,
      pitch: 56,
      bearing: -29,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true, contextType: "webgl2" },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;

    let cancelled = false;
    const addFloors = async () => {
      if (cancelled || map.getSource("floors")) return;
      try {
        hideBasemapExtrusions(map);
        // Soft afternoon light and a pale sky at the horizon when the camera tilts.
        map.setLight({ anchor: "map", position: [1.3, 210, 35], color: "#ffffff", intensity: 0.42 });
        map.setSky({
          "sky-color": "#c3d7ee",
          "horizon-color": "#eef1f4",
          "fog-color": "#f2f2f0",
          "sky-horizon-blend": 0.6,
          "horizon-fog-blend": 0.8,
          "fog-ground-blend": 0.9,
          "atmosphere-blend": 0,
        });
        await Promise.all([registerCustomBadges(map), registerRouteMarkerIcons(map)]);
        if (cancelled) return;
        const response = await fetch("/data/hunter-floors.geojson?v=10");
        if (!response.ok) throw new Error(`Could not load floor data (${response.status})`);
        const data = await response.json();
        if (cancelled) return;
        dataRef.current = data.features;
        map.addSource("floors", { type: "geojson", data, promoteId: "id" });
        map.addLayer({
          id: "campus-flat",
          type: "fill",
          source: "floors",
          filter: ["==", ["get", "kind"], "context"],
          paint: {
            "fill-color": "#cbc8c2",
            "fill-opacity": 0.9,
          },
        });
        if (map.getSource("openmaptiles")) {
          map.addLayer({
            id: "context-buildings",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            minzoom: 14,
            filter: ["!", ["in", ["id"], ["literal", BASEMAP_HUNTER_IDS]]],
            paint: {
              "fill-extrusion-color": "#e6e3dd",
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
              "fill-extrusion-opacity": 0.92,
              "fill-extrusion-vertical-gradient": true,
            },
          });
        }
        map.addLayer({
          id: "hunter-mass",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          paint: {
            "fill-extrusion-color": HUNTER_FACADE,
            "fill-extrusion-base": 0,
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        // A thin pale cap reads as a rooftop and separates the buildings from each other.
        map.addLayer({
          id: "hunter-roofs",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          paint: {
            "fill-extrusion-color": HUNTER_ROOF,
            "fill-extrusion-base": ["get", "height"],
            "fill-extrusion-height": ["+", ["get", "height"], 0.6],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "hunter-bridges",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "bridge"],
          paint: {
            "fill-extrusion-color": "#5b238a",
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        map.addLayer({
          id: "stacked-podiums",
          type: "fill-extrusion",
          source: "floors",
          filter: stackedPodiumFilter(floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": "#d2d0ca",
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["+", ["get", "base"], STOREY_HEIGHT],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        map.addLayer({
          id: "floor-plate",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("floor", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#e6e6e6"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "hallways",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("hallway", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#cdd6e0"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "rooms",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("room", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": roomColor(null),
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "room-outlines",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("room-outline", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#848994"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "walls",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("wall", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#74777d"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        // Selected room: a pulsing glow slab on top of the room plus a short, faint halo above it.
        map.addLayer({
          id: "room-selected-glow",
          type: "fill-extrusion",
          source: "floors",
          filter: selectedRoomFilter(null, null),
          paint: {
            "fill-extrusion-color": "#34d399",
            "fill-extrusion-base": ["get", "height"],
            "fill-extrusion-height": ["+", ["get", "height"], 0.3],
            "fill-extrusion-opacity": 0.9,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addLayer({
          id: "room-selected-beam",
          type: "fill-extrusion",
          source: "floors",
          filter: selectedRoomFilter(null, null),
          paint: {
            "fill-extrusion-color": "#6ee7b7",
            "fill-extrusion-base": ["+", ["get", "height"], 0.3],
            "fill-extrusion-height": ["+", ["get", "height"], 1.5],
            "fill-extrusion-opacity": 0.25,
            "fill-extrusion-vertical-gradient": false,
          },
        });
        map.addSource("campus-markers", {
          type: "geojson",
          data: "/data/campus-markers.geojson?v=11",
        });
        map.addLayer({
          id: "campus-room-labels",
          type: "symbol",
          source: "campus-markers",
          filter: ["==", ["get", "level"], floorRef.current ?? 1],
          layout: {
            "symbol-placement": "point",
            "icon-image": ["step", ["zoom"], markerIcon("dot-classroom"), 18.6, markerIcon("badge-classroom")],
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              16, 0.48,
              17.5, 0.65,
              19, 0.85
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "base"], 0.28],
            "text-field": ["get", "displayCode"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              16, 9.5,
              17.5, 11,
              19, 12.5
            ],
            "text-anchor": "left",
            "text-offset": [0.85, 0],
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-optional": true,
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
            "text-max-width": 12,
          },
          paint: {
            "text-color": "#1e293b",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });
        const initialRoute = routeToGeoJSON(activeRouteRef.current);
        map.addSource("route-ribbons", {
          type: "geojson",
          data: initialRoute.ribbons,
        });
        map.addSource("route-markers", {
          type: "geojson",
          data: initialRoute.markers,
        });
        map.addLayer({
          id: "route-ribbons",
          type: "fill-extrusion",
          source: "route-ribbons",
          paint: {
            "fill-extrusion-color": ["coalesce", ["get", "color"], "#8b5cf6"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 0.65,
            "fill-extrusion-vertical-gradient": true,
          },
        });
        map.addLayer({
          id: "route-markers-label",
          type: "symbol",
          source: "route-markers",
          layout: {
            "symbol-placement": "point",
            "icon-image": ["match", ["get", "kind"], "start", "route-start", "route-destination"],
            "icon-size": 0.8,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "text-field": [
              "case",
              ["==", ["get", "kind"], "start"],
              ["concat", "Start: ", ["get", "label"]],
              ["==", ["get", "kind"], "destination"],
              ["concat", "End: ", ["get", "label"]],
              ["get", "label"]
            ],
            "text-size": 12,
            "text-anchor": "left",
            "text-offset": [1.25, 0],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "base"], 1.1],
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
          },
          paint: {
            "text-color": [
              "case",
              ["==", ["get", "kind"], "start"], "#065f46",
              ["==", ["get", "kind"], "destination"], "#92400e",
              "#4338ca"
            ],
            "text-halo-color": "#ffffff",
            "text-halo-width": 2.5,
          },
        });
        map.addLayer({
          id: "room-selected-label",
          type: "symbol",
          source: "campus-markers",
          filter: selectedRoomFilter(null, null),
          layout: {
            "symbol-placement": "point",
            "text-field": ["get", "roomId"],
            "text-size": 16,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "base"], 3],
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
          },
          paint: {
            "text-color": "#065f46",
            "text-halo-color": "#ffffff",
            "text-halo-width": 3,
          },
        });
        map.addLayer({
          id: "building-labels",
          type: "symbol",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          layout: {
            "symbol-placement": "point",
            "text-field": ["get", "name"],
            "text-size": 12,
            "text-max-width": 9,
            "text-allow-overlap": true,
            "text-pitch-alignment": "map",
            "text-rotation-alignment": "map",
            "symbol-height-anchor": "absolute",
            "symbol-height-offset": ["+", ["get", "height"], 1],
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#4b1d72",
            "text-halo-width": 1.25,
          },
        });
        setMode(map, floorRef.current, buildingIdRef.current, directionModeRef.current);
        map.on("click", "rooms", (event) => {
          const roomId = event.features?.[0]?.properties?.roomId;
          if (roomId) onSelectRoomRef.current(String(roomId));
        });
        map.on("mouseenter", "rooms", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "rooms", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", "campus-room-labels", (event) => {
          const roomId = event.features?.[0]?.properties?.roomId;
          if (roomId) onSelectRoomRef.current(String(roomId));
        });
        map.on("mouseenter", "campus-room-labels", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "campus-room-labels", () => {
          map.getCanvas().style.cursor = "";
        });
        map.resize();
        await new Promise<void>((resolve) => {
          const onData = (event: { sourceId?: string }) => {
            if (event.sourceId !== "floors" || !map.isSourceLoaded("floors")) return;
            map.off("sourcedata", onData);
            resolve();
          };
          map.on("sourcedata", onData);
        });
        if (cancelled) return;
        setStatus("");
        setReady(true);
        if (rootRef.current) rootRef.current.dataset.ready = "1";
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Could not load campus map");
      }
    };

    map.on("error", (event) => {
      const message = event.error?.message ?? "Map failed to render";
      if (!map.getSource("floors")) setStatus(message);
    });
    map.once("load", () => {
      void addFloors();
    });
    if (map.loaded()) void addFloors();

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(rootRef.current);

    return () => {
      cancelled = true;
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("rooms")) return;
    setMode(map, floor, buildingId, directionMode);
    // Keep the 3D structure legible through the route and nearby rooms.
    map.setPaintProperty("rooms", "fill-extrusion-opacity", directionMode ? 0.35 : 1);
    map.setPaintProperty("walls", "fill-extrusion-opacity", directionMode ? 0.5 : 1);
    if (map.getLayer("campus-room-labels")) {
      map.setPaintProperty("campus-room-labels", "icon-opacity", directionMode ? 0.3 : 1);
      map.setPaintProperty("campus-room-labels", "text-opacity", directionMode ? 0.4 : 1);
    }
  }, [ready, floor, buildingId, directionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("rooms")) return;
    map.setPaintProperty("rooms", "fill-extrusion-color", roomColor(selectedRoom));
    map.setFilter("room-selected-glow", selectedRoomFilter(selectedRoom, floorRef.current));
    map.setFilter("room-selected-beam", selectedRoomFilter(selectedRoom, floorRef.current));
    map.setFilter("room-selected-label", selectedRoomFilter(selectedRoom, floorRef.current));
    if (!selectedRoom || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Pulse only the two single-feature layers, about 30 times a second.
    let frame = 0;
    let last = 0;
    const pulse = (time: number) => {
      frame = requestAnimationFrame(pulse);
      if (time - last < 33) return;
      last = time;
      const wave = (Math.sin(time / 380) + 1) / 2;
      map.setPaintProperty("room-selected-glow", "fill-extrusion-opacity", 0.55 + wave * 0.45);
      map.setPaintProperty("room-selected-beam", "fill-extrusion-opacity", 0.1 + wave * 0.25);
    };
    frame = requestAnimationFrame(pulse);
    return () => cancelAnimationFrame(frame);
  }, [ready, selectedRoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const geojson = routeToGeoJSON(activeRoute);
    const ribbonSource = map.getSource("route-ribbons") as GeoJSONSource | undefined;
    const markerSource = map.getSource("route-markers") as GeoJSONSource | undefined;
    if (ribbonSource) ribbonSource.setData(geojson.ribbons);
    if (markerSource) markerSource.setData(geojson.markers);
  }, [ready, activeRoute]);

  useEffect(() => {
    const map = mapRef.current;
    // Picking a room brings it into view; route framing below takes over in Directions.
    if (!ready || !map || !selectedRoom || directionMode) return;
    fitRoom(map, dataRef.current, selectedRoom, floorRef.current, panelOpenRef.current);
    return () => { map.stop(); };
  }, [ready, selectedRoom, directionMode]);

  useEffect(() => {
    const map = mapRef.current;
    // Frame the route on this floor as soon as it is found, then each leg once guidance starts.
    if (!ready || !map || !directionMode || !activeRoute) return;
    fitFeatures(
      map,
      dataRef.current,
      floorRef.current,
      buildingIdRef.current,
      panelOpenRef.current,
      activeRoute,
      activeLegIndex,
      directionMode
    );
    // Stop a route animation if the user leaves Directions mid-transition.
    return () => { map.stop(); };
  }, [ready, activeRoute, activeLegIndex, directionMode]);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={rootRef} className="h-full min-h-0 w-full" />
      {status ? (
        <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-[#3f3b36]">
          {status}
        </p>
      ) : null}
    </div>
  );
}
