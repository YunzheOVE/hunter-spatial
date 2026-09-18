"use client";

import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STOREY = 3.5;

type Props = {
  buildingId: string | null;
  floor: number | null;
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

function indoorFilter(kind: string, floor: number | null): FilterSpecification {
  const clauses: unknown[] = ["all", ["==", ["get", "kind"], kind], ["==", ["get", "scope"], "indoor"]];
  if (floor !== null) clauses.push(["==", ["get", "level"], floor]);
  return clauses as FilterSpecification;
}

function floorBase(floor: number): number {
  return (floor - 1) * STOREY;
}

function hasWebGL2(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2"));
}

function fitFeatures(map: MapLibreMap, data: FloorFeature[], floor: number | null) {
  const features =
    floor == null
      ? data.filter((item) => item.properties.kind === "mass")
      : data.filter((item) => item.properties.scope === "indoor" && item.properties.level === floor);
  const box = bboxOfMany(features.length ? features : data);
  if (!box) return;
  map.fitBounds(box, {
    padding: 80,
    pitch: 56,
    bearing: -29,
    duration: 700,
    maxZoom: floor != null && floor >= 10 ? 16.4 : 17,
  });
}

function roomColor(selectedRoom: string | null, buildingId: string | null): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "roomId"], selectedRoom ?? ""],
    "#e2b857",
    ["all", ["!=", buildingId ?? "", ""], ["!=", ["get", "building"], buildingId ?? ""]],
    "#a78bfa",
    "#6d28d9",
  ];
}

function hideBasemapExtrusions(map: MapLibreMap) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === "fill-extrusion") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

function setMode(map: MapLibreMap, floor: number | null) {
  const indoor = floor != null;
  for (const id of ["hallways", "rooms"]) {
    map.setLayoutProperty(id, "visibility", indoor ? "visible" : "none");
  }
  map.setLayoutProperty("hunter-mass", "visibility", "visible");

  if (!indoor) {
    map.setPaintProperty("hunter-mass", "fill-extrusion-base", 0);
    map.setPaintProperty("hunter-mass", "fill-extrusion-height", ["get", "height"]);
    map.setPaintProperty("hunter-mass", "fill-extrusion-color", "#6d28d9");
    return;
  }

  const base = floorBase(floor);
  const podium = Math.max(0, base);
  map.setLayoutProperty("hunter-mass", "visibility", podium > 0.1 ? "visible" : "none");
  map.setPaintProperty("hunter-mass", "fill-extrusion-base", 0);
  map.setPaintProperty("hunter-mass", "fill-extrusion-height", podium);
  map.setPaintProperty("hunter-mass", "fill-extrusion-color", "#d8d3cb");
  map.setFilter("hallways", indoorFilter("hallway", floor));
  map.setFilter("rooms", indoorFilter("room", floor));
  map.setPaintProperty("hallways", "fill-extrusion-base", base);
  map.setPaintProperty("hallways", "fill-extrusion-height", base + 0.5);
  map.setPaintProperty("rooms", "fill-extrusion-base", base);
  map.setPaintProperty("rooms", "fill-extrusion-height", base + 3.1);
}

export function MapView({ buildingId, floor, selectedRoom, onSelectRoom }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRoomRef = useRef(onSelectRoom);
  const floorRef = useRef(floor);
  const dataRef = useRef<FloorFeature[]>([]);
  const didFit = useRef(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading campus map…");
  onSelectRoomRef.current = onSelectRoom;
  floorRef.current = floor;

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
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    let cancelled = false;
    const addFloors = async () => {
      if (cancelled || map.getSource("floors")) return;
      try {
        hideBasemapExtrusions(map);
        const response = await fetch("/data/hunter-floors.geojson");
        if (!response.ok) throw new Error(`Could not load floor data (${response.status})`);
        const data = await response.json();
        if (cancelled) return;
        dataRef.current = data.features;
        map.addSource("floors", { type: "geojson", data, promoteId: "id" });
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
          },
        });
        map.addLayer({
          id: "hallways",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("hallway", floorRef.current),
          paint: {
            "fill-extrusion-color": "#ece7de",
            "fill-extrusion-base": 0,
            "fill-extrusion-height": 0.5,
            "fill-extrusion-opacity": 1,
          },
        });
        map.addLayer({
          id: "rooms",
          type: "fill-extrusion",
          source: "floors",
          filter: indoorFilter("room", floorRef.current),
          paint: {
            "fill-extrusion-color": "#6d28d9",
            "fill-extrusion-base": 0,
            "fill-extrusion-height": 3.1,
            "fill-extrusion-opacity": 1,
          },
        });
        setMode(map, floorRef.current);
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
    setMode(map, floor);
  }, [ready, floor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("rooms")) return;
    map.setPaintProperty("rooms", "fill-extrusion-color", roomColor(selectedRoom, buildingId));
    if (floor == null) {
      map.setPaintProperty(
        "hunter-mass",
        "fill-extrusion-color",
        buildingId
          ? ["case", ["==", ["get", "building"], buildingId], "#6d28d9", "#a78bfa"]
          : "#6d28d9",
      );
    }
  }, [ready, selectedRoom, buildingId, floor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    fitFeatures(map, dataRef.current, floor);
  }, [ready, floor]);

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
