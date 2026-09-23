"use client";

import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource } from "maplibre-gl";
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
  const container = map.getContainer();
  const desktop = container.clientWidth >= 768;
  const padding = panelOpen
    ? desktop
      ? { top: 90, right: 80, bottom: 90, left: 410 }
      : { top: Math.min(480, container.clientHeight * 0.54 + 20), right: 36, bottom: 50, left: 36 }
    : { top: 80, right: 80, bottom: 80, left: 80 };

  const targetMaxZoom = isStepFocus
    ? 19.6 // Zoom closely on the active route corridor so users see turns and doors clearly
    : activeRoute
      ? 18.5
      : indoor
        ? 18.2
        : 16.7;

  map.fitBounds(box, {
    padding,
    pitch: indoor ? 52 : 48,
    bearing: -20,
    duration: 750,
    maxZoom: targetMaxZoom,
  });
}

function createBadgeImage(
  bgColor: string,
  drawSymbol: (ctx: CanvasRenderingContext2D) => void,
): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, 64, 64);

  // Outer white circle halo for high contrast
  ctx.save();
  ctx.beginPath();
  ctx.arc(32, 32, 27, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.fill();

  // Circular colored background
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();

  // Draw white icon pictogram
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawSymbol(ctx);

  ctx.restore();
  return ctx.getImageData(0, 0, 64, 64);
}

function drawStairsIcon(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(18, 43);
  ctx.lineTo(25, 43);
  ctx.lineTo(25, 35);
  ctx.lineTo(32, 35);
  ctx.lineTo(32, 27);
  ctx.lineTo(39, 27);
  ctx.lineTo(39, 19);
  ctx.lineTo(46, 19);
  ctx.stroke();
  ctx.restore();
}

function drawElevatorIcon(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(19, 17, 26, 30, 4);
  } else {
    ctx.rect(19, 17, 26, 30);
  }
  ctx.stroke();

  // Vertical center door division
  ctx.beginPath();
  ctx.moveTo(32, 17);
  ctx.lineTo(32, 47);
  ctx.stroke();

  // Inner door panel handles/indicator bars
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(23, 24, 4, 16);
  ctx.fillRect(37, 24, 4, 16);
  ctx.restore();
}

function drawRestroomMenIcon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.arc(32, 22, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(26, 30);
  ctx.lineTo(38, 30);
  ctx.moveTo(32, 30);
  ctx.lineTo(32, 38);
  ctx.lineTo(28, 47);
  ctx.moveTo(32, 38);
  ctx.lineTo(36, 47);
  ctx.stroke();
}

function drawRestroomWomenIcon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.arc(32, 22, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(32, 28);
  ctx.lineTo(25, 40);
  ctx.lineTo(39, 40);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(29, 40);
  ctx.lineTo(29, 47);
  ctx.moveTo(35, 40);
  ctx.lineTo(35, 47);
  ctx.stroke();
}

function drawRestroomUnisexIcon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.arc(27, 23, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(23, 29);
  ctx.lineTo(29, 29);
  ctx.moveTo(26, 29);
  ctx.lineTo(26, 37);
  ctx.lineTo(24, 46);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(37, 23, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(37, 28);
  ctx.lineTo(32, 39);
  ctx.lineTo(42, 39);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(37, 39);
  ctx.lineTo(37, 46);
  ctx.stroke();
}

function drawClassroomIcon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(32, 40);
  ctx.quadraticCurveTo(24, 41, 20, 39);
  ctx.lineTo(20, 26);
  ctx.quadraticCurveTo(25, 28, 32, 27);
  ctx.quadraticCurveTo(39, 28, 44, 26);
  ctx.lineTo(44, 39);
  ctx.quadraticCurveTo(40, 41, 32, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(32, 27);
  ctx.lineTo(32, 40);
  ctx.stroke();
}

function drawStudyIcon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(32, 19);
  ctx.lineTo(35, 27);
  ctx.lineTo(44, 32);
  ctx.lineTo(35, 37);
  ctx.lineTo(32, 45);
  ctx.lineTo(29, 37);
  ctx.lineTo(20, 32);
  ctx.lineTo(29, 27);
  ctx.closePath();
  ctx.fill();
}

function drawFoodIcon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(22, 26);
  ctx.lineTo(40, 26);
  ctx.lineTo(38, 40);
  ctx.quadraticCurveTo(31, 43, 24, 40);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(40, 32, 4, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
}

function drawOfficeIcon(ctx: CanvasRenderingContext2D) {
  ctx.strokeRect(21, 27, 22, 15);
  ctx.beginPath();
  ctx.moveTo(26, 27);
  ctx.lineTo(26, 22);
  ctx.lineTo(38, 22);
  ctx.lineTo(38, 27);
  ctx.stroke();
}

function drawLectureIcon(ctx: CanvasRenderingContext2D) {
  ctx.strokeRect(21, 22, 22, 16);
  ctx.beginPath();
  ctx.moveTo(32, 38);
  ctx.lineTo(32, 45);
  ctx.moveTo(25, 45);
  ctx.lineTo(39, 45);
  ctx.stroke();
}

function registerCustomBadges(map: MapLibreMap) {
  const badgeDefs: [string, string, (ctx: CanvasRenderingContext2D) => void][] = [
    ["badge-classroom", "#1e293b", drawClassroomIcon],
    ["badge-stairs", "#2563eb", drawStairsIcon],
    ["badge-elevator", "#2563eb", drawElevatorIcon],
    ["badge-restroom-men", "#2563eb", drawRestroomMenIcon],
    ["badge-restroom-women", "#ec4899", drawRestroomWomenIcon],
    ["badge-restroom", "#15803d", drawRestroomUnisexIcon],
    ["badge-study", "#d97706", drawStudyIcon],
    ["badge-food", "#ea580c", drawFoodIcon],
    ["badge-office", "#475569", drawOfficeIcon],
    ["badge-lecture", "#7c3aed", drawLectureIcon],
  ];

  for (const [id, color, drawer] of badgeDefs) {
    if (!map.hasImage(id)) {
      const img = createBadgeImage(color, drawer);
      if (img) {
        map.addImage(id, img, { pixelRatio: 2 });
      }
    }
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
  ]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", indoor ? "visible" : "none");
    }
  }
  map.setLayoutProperty("campus-flat", "visibility", indoor ? "none" : "visible");
  map.setLayoutProperty("building-labels", "visibility", indoor ? "none" : "visible");
  map.setLayoutProperty("hunter-mass", "visibility", indoor ? "none" : "visible");

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
        map.setPaintProperty("hunter-bridges", "fill-extrusion-color", "#5b238a");
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
    map.setPaintProperty("hunter-mass", "fill-extrusion-color", "#5b238a");
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
        registerCustomBadges(map);
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
        map.addLayer({
          id: "hunter-mass",
          type: "fill-extrusion",
          source: "floors",
          filter: ["==", ["get", "kind"], "mass"],
          paint: {
            "fill-extrusion-color": "#6d28d9",
            "fill-extrusion-base": 0,
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": true,
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
        map.addSource("campus-markers", {
          type: "geojson",
          data: "/data/campus-markers.geojson?v=10",
        });
        map.addLayer({
          id: "campus-room-labels",
          type: "symbol",
          source: "campus-markers",
          filter: ["==", ["get", "level"], floorRef.current ?? 1],
          layout: {
            "symbol-placement": "point",
            "icon-image": ["coalesce", ["get", "iconBadge"], "badge-classroom"],
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
            "text-field": [
              "case",
              ["==", ["get", "kind"], "start"],
              ["concat", "🟢 Start: ", ["get", "label"]],
              ["==", ["get", "kind"], "destination"],
              ["concat", "🏁 End: ", ["get", "label"]],
              ["get", "label"]
            ],
            "text-size": 12,
            "text-anchor": "bottom",
            "text-offset": [0, -0.6],
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
    // Exploring changes visible content, never the user's camera position.
    if (!ready || !map || !directionMode || !activeRoute || activeLegIndex == null) return;
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
