"use client";

import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import {
  campusBuildingsAtLevel,
  campusPodiumLevels,
  CAMPUS_TOP_FLOORS,
  type CampusBuildingId,
  STOREY_HEIGHT,
} from "@/lib/campusLevels";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type Props = {
  buildingId: CampusBuildingId | null;
  floor: number | null;
  panelOpen: boolean;
  selectedRoom: string | null;
  onSelectRoom: (roomId: string) => void;
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

function fitFeatures(
  map: MapLibreMap,
  data: FloorFeature[],
  floor: number | null,
  buildingId: CampusBuildingId | null,
  panelOpen: boolean,
) {
  const indoor = floor != null;
  const features =
    !indoor
      ? data.filter((item) => item.properties.kind === "mass")
      : buildingId == null
        ? data.filter((item) => item.properties.kind === "floor")
        : data.filter((item) => isVisibleFloor(item, floor, buildingId));
  const box = bboxOfMany(features.length ? features : data);
  if (!box) return;
  const container = map.getContainer();
  const desktop = container.clientWidth >= 768;
  const padding = panelOpen
    ? desktop
      ? { top: 90, right: 80, bottom: 90, left: 410 }
      : { top: Math.min(500, container.clientHeight * 0.58 + 24), right: 42, bottom: 60, left: 42 }
    : { top: 90, right: 80, bottom: 90, left: 80 };
  map.fitBounds(box, {
    padding,
    pitch: indoor ? 52 : 48,
    bearing: -20,
    duration: 700,
    maxZoom: indoor ? 18.2 : 16.7,
  });
}

function roomColor(selectedRoom: string | null): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "roomId"], selectedRoom ?? ""],
    "#35b779",
    "#e1e6ec",
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
) {
  const indoor = floor != null;
  for (const id of ["stacked-podiums", "floor-plate", "hallways", "rooms", "walls"]) {
    map.setLayoutProperty(id, "visibility", indoor ? "visible" : "none");
  }
  map.setLayoutProperty("campus-flat", "visibility", indoor ? "none" : "visible");
  map.setLayoutProperty("hunter-bridges", "visibility", indoor ? "none" : "visible");
  map.setLayoutProperty("building-labels", "visibility", indoor ? "none" : "visible");
  map.setLayoutProperty("hunter-mass", "visibility", indoor ? "none" : "visible");

  if (!indoor) {
    map.setFilter("hunter-mass", ["==", ["get", "kind"], "mass"]);
    map.setPaintProperty("hunter-mass", "fill-extrusion-base", 0);
    map.setPaintProperty("hunter-mass", "fill-extrusion-height", ["get", "height"]);
    map.setPaintProperty("hunter-mass", "fill-extrusion-color", "#5b238a");
    return;
  }

  map.setFilter("stacked-podiums", stackedPodiumFilter(floor, buildingId));
  map.setFilter("floor-plate", indoorFilter("floor", floor, buildingId));
  map.setFilter("hallways", indoorFilter("hallway", floor, buildingId));
  map.setFilter("rooms", indoorFilter("room", floor, buildingId));
  map.setFilter("walls", indoorFilter("wall", floor, buildingId));
}

export function MapView({ buildingId, floor, panelOpen, selectedRoom, onSelectRoom }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRoomRef = useRef(onSelectRoom);
  const floorRef = useRef(floor);
  const buildingIdRef = useRef(buildingId);
  const dataRef = useRef<FloorFeature[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading campus map…");
  onSelectRoomRef.current = onSelectRoom;
  floorRef.current = floor;
  buildingIdRef.current = buildingId;

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
        const response = await fetch("/data/hunter-floors.geojson?v=4");
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
            "fill-extrusion-color": "#fbfbfa",
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
            "fill-extrusion-color": "#f8f9fa",
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
          id: "walls",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("wall", floorRef.current, buildingIdRef.current),
          paint: {
            "fill-extrusion-color": "#74777d",
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 1,
            "fill-extrusion-vertical-gradient": false,
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
        setMode(map, floorRef.current, buildingIdRef.current);
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
    setMode(map, floor, buildingId);
  }, [ready, floor, buildingId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("rooms")) return;
    map.setPaintProperty("rooms", "fill-extrusion-color", roomColor(selectedRoom));
  }, [ready, selectedRoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    fitFeatures(map, dataRef.current, floor, buildingId, panelOpen);
  }, [ready, floor, buildingId, panelOpen]);

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
