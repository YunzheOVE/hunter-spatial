"use client";

import dynamic from "next/dynamic";
import { RoomCard } from "./RoomCard";
import { PanoramaModal } from "./PanoramaModal";
import { UploadPanel } from "./UploadPanel";
import { LevelControl } from "./LevelControl";
import { Glyph, WayfindingIcon, type WayfindingIconName } from "./WayfindingIcon";
import { ROOM_MEDIA } from "@/lib/roomMedia";
import type { SessionUser } from "@/lib/uploads";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  campusLevelsForSelection,
  type CampusBuildingId,
  closestCampusLevel,
} from "@/lib/campusLevels";
import { canonicalRoomId, parseRoomId } from "@/lib/parseRoomId";
import {
  fetchRoutingGraph,
  edgeSeconds,
  findRoute,
  resolveRoom,
  type RouteResult,
  type RoutingGraphData,
} from "@/lib/pathfinding";

const MapView = dynamic(() => import("./MapView").then((module) => module.MapView), { ssr: false });

const BUILDINGS = [
  { id: "N", name: "North Building" },
  { id: "E", name: "East Building" },
  { id: "W", name: "West Building" },
  { id: "TH", name: "Thomas Hunter Hall" },
  { id: "BTB", name: "Baker Theatre" },
] as const;

const POPULAR_ROOMS = ["W305", "E303", "N11007", "W502", "B201", "BTB105"];

// Categories match the room names that exist in routing-graph.json.
const CATEGORIES: { id: string; label: string; icon: ReactNode; test: (id: string, name: string) => boolean }[] = [
  { id: "classroom", label: "Classrooms", icon: <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M15 12h.01" />, test: (_, name) => /classroom/i.test(name) },
  { id: "restroom", label: "Restrooms", icon: <><circle cx="8" cy="5" r="1.6" /><circle cx="16" cy="5" r="1.6" /><path d="M8 9v12M16 9l-3 7h6l-3-7" /></>, test: (_, name) => /washroom|restroom/i.test(name) },
  { id: "food", label: "Food & lounges", icon: <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2" />, test: (_, name) => /caf|dining|food|lounge/i.test(name) },
  { id: "pano", label: "360° views", icon: <><ellipse cx="12" cy="12" rx="9" ry="4" /><path d="M12 3a4 9 0 0 1 0 18" /></>, test: (id) => Boolean(ROOM_MEDIA[id]?.panorama) },
];

const ICONS = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  directions: <><path d="M12 2 2 12l10 10 10-10z" /><path d="M9 14v-2a2 2 0 0 1 2-2h4" /><path d="m13 8 2 2-2 2" /></>,
  swap: <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  prev: <path d="M15 18 9 12l6-6" />,
  next: <path d="m9 18 6-6-6-6" />,
  start: <path d="m3 11 18-8-8 18-2-8z" />,
  walk: <><circle cx="13" cy="4" r="1.6" /><path d="m9 21 3-7 3 3v4M7 12l3-4 4 1 3 3" /></>,
  accessible: <><circle cx="12" cy="4" r="1.6" /><path d="M12 7v6h5l2 5M9 10a6 6 0 1 0 7 8" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
  pin: <><path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
};

// Frosted glass: every floating card lets the map show through.
const card = "border border-white/60 bg-white/75 backdrop-blur-md backdrop-saturate-150 shadow-[0_1px_3px_rgba(60,64,67,.25),0_4px_12px_rgba(60,64,67,.12)]";
const iconButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-black/5";
const chipClass = "flex h-10 shrink-0 items-center gap-2 rounded-full pr-4 pl-3 text-sm font-medium whitespace-nowrap transition";

type Panel = "results" | "place" | "directions" | "contribute";

function buildingName(id: string) {
  return BUILDINGS.find((b) => b.id === id)?.name ?? `${id} Building`;
}

function levelName(level: number) {
  return level === 0 ? "Concourse" : `Level ${level}`;
}

function transitionTime(seconds: number) {
  return seconds < 60 ? "Under a minute" : `About ${Math.round(seconds / 60)} min`;
}

export function CampusApp() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [buildingId, setBuildingId] = useState<CampusBuildingId | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [panoramaRoom, setPanoramaRoom] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Session is shared by the account button and the Contribute panel.
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState("");

  // Directions state
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [originFocused, setOriginFocused] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [activeRoute, setActiveRoute] = useState<RouteResult | null>(null);
  const [activeLegIndex, setActiveLegIndex] = useState<number | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const navigating = activeRoute != null && activeLegIndex != null;
  const activeStepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeLegIndex, showSteps]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routingGraph, setRoutingGraph] = useState<RoutingGraphData | null>(null);
  const [locationsError, setLocationsError] = useState(false);

  type RoomSuggestion = {
    id: string;
    name: string;
    building: string;
    level: number;
  };

  // Prefetch routing graph in the background
  useEffect(() => {
    fetchRoutingGraph()
      .then((data) => setRoutingGraph(data))
      .catch((err) => { setLocationsError(true); console.warn("Failed to prefetch routing graph:", err); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((body: { user: SessionUser | null }) => setUser(body.user))
      .catch(() => { if (!controller.signal.aborted) setSessionError("Unable to check sign-in. Refresh the page to try again."); })
      .finally(() => { if (!controller.signal.aborted) setCheckingSession(false); });
    return () => controller.abort();
  }, []);

  const roomKeys = useMemo(
    () => (routingGraph ? Object.keys(routingGraph.rooms).sort() : []),
    [routingGraph]
  );
  // "Building:level" pairs that an elevator stops at, for the place card's step-free row.
  const elevatorFloors = useMemo(() => {
    const floors = new Set<string>();
    for (const edge of routingGraph?.edges ?? []) {
      if (edge.type !== "elevator") continue;
      for (const node of [routingGraph?.nodes[edge.from], routingGraph?.nodes[edge.to]]) {
        if (node) floors.add(`${node.building}:${node.level}`);
      }
    }
    return floors;
  }, [routingGraph]);

  const searchTerm = query.trim().toLowerCase();
  const activeCategory = CATEGORIES.find((c) => c.id === category);
  const exploreResults = !searchTerm && !activeCategory
    ? POPULAR_ROOMS.filter((id) => routingGraph?.rooms[id])
    : roomKeys.filter((id) => {
      const room = routingGraph!.rooms[id];
      return (!activeCategory || activeCategory.test(id, room.name)) &&
        (!buildingId || room.building === buildingId) &&
        (!searchTerm || `${id} ${room.name}`.toLowerCase().includes(searchTerm));
    });
  const selectedDetails = selectedRoom && routingGraph ? resolveRoom(routingGraph, selectedRoom) : null;
  const selectedInfo = selectedDetails ? routingGraph?.rooms[selectedDetails.roomId] : null;

  function selectExploreRoom(id: string) {
    const room = routingGraph?.rooms[id];
    if (!room) return;
    setSelectedRoom(id);
    setQuery(id);
    setBuildingId(room.building as CampusBuildingId);
    setFloor(room.level);
    setError(null);
    setPanel("place");
  }

  function closeSearch() {
    setQuery("");
    setCategory(null);
    setSelectedRoom(null);
    setError(null);
    setMenuOpen(false);
    setPanel(null);
  }

  function toggleCategory(id: string) {
    setCategory(category === id ? null : id);
    setQuery("");
    setSelectedRoom(null);
    setPanel(category === id ? null : "results");
  }

  const getSuggestions = (queryText: string, isFocused: boolean): RoomSuggestion[] => {
    if (!routingGraph || !isFocused) return [];
    const q = queryText.trim().toUpperCase();
    if (!q) {
      return POPULAR_ROOMS
        .filter((key) => routingGraph.rooms[key])
        .map((key) => {
          const r = routingGraph.rooms[key];
          return { id: key, name: r.name, building: r.building, level: r.level };
        });
    }

    const results: RoomSuggestion[] = [];
    const tokens = q.split(/\s+/).filter(Boolean);

    // If query resolves to a specific location (e.g. natural language facility search), prioritize it
    const resolved = resolveRoom(routingGraph, queryText);
    if (resolved) {
      results.push({
        id: resolved.roomId,
        name: resolved.room.name,
        building: resolved.room.building,
        level: resolved.room.level,
      });
    }

    for (const key of roomKeys) {
      if (resolved && key === resolved.roomId) continue;
      const r = routingGraph.rooms[key];
      if (!r) continue;
      const combined = `${key} ${r.name || ""}`.toUpperCase();
      const matchAll = tokens.every((tok) => combined.includes(tok));
      if (matchAll) {
        results.push({ id: key, name: r.name, building: r.building, level: r.level });
        if (results.length >= 7) break;
      }
    }
    return results;
  };

  const originSuggestions = useMemo(
    () => getSuggestions(originQuery, originFocused),
    [originQuery, originFocused, routingGraph, roomKeys]
  );

  const destSuggestions = useMemo(
    () => getSuggestions(destinationQuery, destFocused),
    [destinationQuery, destFocused, routingGraph, roomKeys]
  );

  function selectOriginSuggestion(sug: RoomSuggestion) {
    setOriginQuery(sug.id);
    setOriginFocused(false);
    if (destinationQuery && destinationQuery !== sug.id) {
      calculateRoute(sug.id, destinationQuery);
    }
  }

  function selectDestSuggestion(sug: RoomSuggestion) {
    setDestinationQuery(sug.id);
    setDestFocused(false);
    if (originQuery && originQuery !== sug.id) {
      calculateRoute(originQuery, sug.id);
    }
  }

  function goToPrevStep() {
    if (!activeRoute || activeLegIndex == null || activeLegIndex <= 0) return;
    selectLeg(activeLegIndex - 1);
  }

  function goToNextStep() {
    if (!activeRoute || activeLegIndex == null || activeLegIndex >= activeRoute.legs.length - 1) return;
    selectLeg(activeLegIndex + 1);
  }

  // ── Turn-by-turn instruction helpers ──────────────────────────────

  type DirectionStep = {
    icon: WayfindingIconName;
    text: string;
    subtext?: string;
    isTransition: boolean;
    legIndex: number;
  };

  function generateDirectionSteps(route: RouteResult): DirectionStep[] {
    const steps: DirectionStep[] = [];
    const { legs, transitions, fromRoom, toRoom } = route;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const bName = buildingName(leg.building);
      const levelText = levelName(leg.level);

      if (i === 0) {
        steps.push({
          icon: "walk",
          text: `Leave ${fromRoom} and head out`,
          subtext: `${bName} · ${levelText}`,
          isTransition: false,
          legIndex: i,
        });
      } else {
        // After a transition, describe the continuation
        const prevTransition = transitions[i - 1];
        if (prevTransition) {
          const exitVerb =
            prevTransition.type === "elevator" ? "Exit elevator" :
            prevTransition.type === "stairs" ? "Exit stairwell" :
            prevTransition.type === "bridge" ? "Continue" :
            "Continue";

          if (i === legs.length - 1) {
            steps.push({
              icon: "forward",
              text: `${exitVerb} and head to ${toRoom}`,
              subtext: `${bName} · ${levelText}`,
              isTransition: false,
              legIndex: i,
            });
          } else {
            steps.push({
              icon: "forward",
              text: `${exitVerb} and continue along ${levelText}`,
              subtext: bName,
              isTransition: false,
              legIndex: i,
            });
          }
        }
      }

      // If there is a transition after this leg, add the transition step
      if (transitions[i]) {
        const t = transitions[i];
        steps.push({
          icon: t.type,
          text: t.description,
          subtext: transitionTime(edgeSeconds(t.type, 0, t.fromLevel, t.toLevel)),
          isTransition: true,
          legIndex: i,
        });
      }
    }

    // Final arrive step
    steps.push({
      icon: "destination",
      text: `Arrive at ${toRoom}`,
      subtext: undefined,
      isTransition: false,
      legIndex: legs.length - 1,
    });

    return steps;
  }

  const directionMode = panel === "directions" || Boolean(activeRoute);
  const campusLevels = campusLevelsForSelection(buildingId);

  function showOutdoor() {
    setBuildingId(null);
    setFloor(null);
    setSelectedRoom(null);
    setError(null);
    if (panel === "place") setPanel(null);
  }

  function selectBuilding(id: CampusBuildingId | null) {
    setBuildingId(id);
    setFloor((currentFloor) => id ? closestCampusLevel(id, currentFloor ?? 1) : currentFloor ?? 1);
    setSelectedRoom(null);
    setError(null);
    if (panel === "place") setPanel(null);
  }

  function selectFloor(level: number) {
    setFloor(level);
    setSelectedRoom(null);
    setError(null);
    if (panel === "place") setPanel(null);
  }

  function goToQuery() {
    try {
      if (routingGraph) {
        const resolved = resolveRoom(routingGraph, query);
        const exactName = roomKeys.find((id) => routingGraph.rooms[id].name.toLowerCase() === query.trim().toLowerCase());
        const match = resolved?.roomId ?? exactName;
        if (match) { selectExploreRoom(match); return; }
        setError("Room not found. Choose a matching location or check the room number.");
        return;
      }
      const parsed = parseRoomId(query);
      const roomId = canonicalRoomId(parsed);
      setError(null);
      setBuildingId(parsed.buildingId);
      setFloor(parsed.floor);
      setSelectedRoom(roomId);
      setPanel("place");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find that room");
    }
  }

  async function calculateRoute(
    fromOverride?: string,
    toOverride?: string,
    accessibleOverride?: boolean
  ) {
    const start = (fromOverride ?? originQuery).trim();
    const target = (toOverride ?? destinationQuery).trim();
    const isAccessible = accessibleOverride ?? accessibleOnly;

    if (!start || !target) {
      setRouteError("Please enter both a start room and a destination.");
      return;
    }

    setActiveRoute(null);
    setActiveLegIndex(null);
    setRouteLoading(true);
    setRouteError(null);

    try {
      const graph = routingGraph ?? (await fetchRoutingGraph());
      if (!routingGraph) setRoutingGraph(graph);

      const resolvedStart = resolveRoom(graph, start);
      if (!resolvedStart) {
        setRouteError(`Room "${start}" was not found in the campus routing index.`);
        setRouteLoading(false);
        return;
      }

      const resolvedTarget = resolveRoom(graph, target);
      if (!resolvedTarget) {
        setRouteError(`Room "${target}" was not found in the campus routing index.`);
        setRouteLoading(false);
        return;
      }

      const result = findRoute(graph, start, target, { accessibleOnly: isAccessible });
      if (!result) {
        setRouteError(
          isAccessible
            ? `No step-free accessible route found between ${resolvedStart.roomId} and ${resolvedTarget.roomId}.`
            : `No route found between ${resolvedStart.roomId} and ${resolvedTarget.roomId}.`
        );
        setActiveRoute(null);
        setActiveLegIndex(null);
        return;
      }

      setActiveRoute(result);
      setActiveLegIndex(null);

      // In direction mode, keep all buildings visible so users see full campus context
      setBuildingId(null);
      const firstLeg = result.legs[0];
      if (firstLeg) {
        setFloor(firstLeg.level);
      }
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Routing calculation failed.");
      setActiveRoute(null);
    } finally {
      setRouteLoading(false);
    }
  }

  function clearRoute() {
    setActiveRoute(null);
    setActiveLegIndex(null);
    setRouteError(null);
    setOriginQuery("");
    setDestinationQuery("");
    setShowSteps(false);
  }

  function closeDirections() {
    clearRoute();
    setPanel(null);
  }

  function swapRooms() {
    const nextOrigin = destinationQuery;
    const nextDest = originQuery;
    setOriginQuery(nextOrigin);
    setDestinationQuery(nextDest);
    if (nextOrigin && nextDest) {
      calculateRoute(nextOrigin, nextDest);
    }
  }

  function selectLeg(index: number) {
    if (!activeRoute || !activeRoute.legs[index]) return;
    setActiveLegIndex(index);
    const leg = activeRoute.legs[index];
    // In direction mode, keep all buildings visible
    setBuildingId(null);
    setFloor(leg.level);
  }

  function openDirections() {
    setMenuOpen(false);
    setPanel("directions");
    setBuildingId(null);
    if (selectedRoom && !originQuery) setOriginQuery(selectedRoom);
  }

  function startDirectionsFrom(roomId: string) {
    setPanel("directions");
    setOriginQuery(roomId);
    if (destinationQuery && destinationQuery !== roomId) {
      calculateRoute(roomId, destinationQuery);
    }
  }

  function startDirectionsTo(roomId: string) {
    setPanel("directions");
    setDestinationQuery(roomId);
    if (originQuery && originQuery !== roomId) {
      calculateRoute(originQuery, roomId);
    }
  }

  function openContribute() {
    setMenuOpen(false);
    setPanel("contribute");
    setActiveRoute(null);
    setActiveLegIndex(null);
    setShowSteps(false);
  }

  function handleMapRoomClick(roomId: string) {
    if (navigating) return;
    setSelectedRoom(roomId);
    if (panel !== "directions") {
      setQuery(roomId);
      setError(null);
      setPanel("place");
    } else if (!originQuery) {
      setOriginQuery(roomId);
    } else {
      setDestinationQuery(roomId);
      calculateRoute(originQuery, roomId);
    }
  }

  // Compute direction steps for the active route
  const directionSteps = useMemo(
    () => (activeRoute ? generateDirectionSteps(activeRoute) : []),
    [activeRoute]
  );

  const legs = activeRoute?.legs ?? [];
  const routeLevels = [...new Set(legs.map((leg) => leg.level))];
  const routeMinutes = activeRoute ? Math.max(1, Math.ceil(activeRoute.estimatedSeconds / 60)) : 0;
  const legSteps = navigating ? directionSteps.filter((step) => step.legIndex === activeLegIndex) : [];
  const currentStep = legSteps[0];
  const thenStep = legSteps[1] ?? directionSteps.find((step) => step.legIndex === (activeLegIndex ?? 0) + 1);
  const lastLeg = navigating && activeLegIndex === legs.length - 1;
  const legNumber = (activeLegIndex ?? 0) + 1;
  const panelVisible = navigating ? showSteps : panel != null;

  const categoryChips = (onMap: boolean) => CATEGORIES.map((c) => (
    <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => toggleCategory(c.id)} className={`${chipClass} ${category === c.id ? "bg-[#5b238a] text-white" : onMap ? `${card} text-[#3c4043] hover:bg-black/5` : "bg-black/5 text-[#3c4043] hover:bg-black/10"}`}>
      <Glyph size={18}>{c.icon}</Glyph>{c.label}
    </button>
  ));

  const roomRow = (id: string) => {
    const room = routingGraph?.rooms[id];
    if (!room) return null;
    return (
      <li key={id}>
        <button type="button" onClick={() => selectExploreRoom(id)} className="flex min-h-16 w-full items-center gap-3.5 px-5 py-2.5 text-left hover:bg-[#5b238a]/10">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1eaf7] text-[#5b238a]"><Glyph>{ICONS.pin}</Glyph></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-[#1f1f1f]">{id}</span>
            <span className="block truncate text-[13px] text-[#5f6368]">{room.name !== id ? `${room.name} · ` : ""}{buildingName(room.building)} · {levelName(room.level)}</span>
          </span>
          {ROOM_MEDIA[id]?.panorama ? <span className="rounded-full bg-[#f1eaf7] px-2 py-1 text-xs font-semibold text-[#5b238a]">360°</span> : null}
        </button>
      </li>
    );
  };

  const resultsList = (
    <div aria-label="Matching locations">
      <p className="px-5 pt-3 pb-1 text-[13px] font-semibold text-[#5f6368]">
        {!searchTerm && !activeCategory ? "Popular places" : `Results${buildingId ? ` in ${buildingName(buildingId)}` : ""}`}
      </p>
      {!routingGraph ? <p role="status" className="px-5 py-3 text-sm">{locationsError ? "Unable to load locations. Refresh the page to try again." : "Loading locations…"}</p>
        : exploreResults.length ? <ul>{exploreResults.slice(0, 30).map(roomRow)}</ul>
        : <p role="status" className="px-5 py-3 text-sm leading-6 text-[#5f6368]">{category === "pano" ? "No 360° locations here yet. Turn off the filter to find rooms and get directions." : "No matching locations. Try another room number or building."}</p>}
    </div>
  );

  const stepList = (
    <ol className="pb-3">
      {directionSteps.map((step, si) => {
        const leg = legs[step.legIndex];
        const header = leg && (si === 0 || directionSteps[si - 1].legIndex !== step.legIndex);
        const isCurrent = navigating && step.legIndex === activeLegIndex;
        return (
          <li key={si}>
            {header ? <p className="px-6 pt-3.5 pb-1.5 text-xs font-bold tracking-wider text-[#5b238a] uppercase">{buildingName(leg.building)} · {levelName(leg.level)}</p> : null}
            <button
              ref={isCurrent && !step.isTransition ? activeStepRef : undefined}
              type="button"
              onClick={() => selectLeg(step.legIndex)}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex w-full items-start gap-4 px-6 py-3 text-left transition-colors ${step.isTransition ? "bg-[#1a56c4]/10 hover:bg-[#1a56c4]/15" : isCurrent ? "bg-[#5b238a]/10" : "hover:bg-black/5"}`}
            >
              {step.isTransition
                ? <span className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1a56c4] text-white"><WayfindingIcon name={step.icon} size={16} /></span>
                : <span className={`mt-0.5 shrink-0 ${step.icon === "destination" ? "text-[#5b238a]" : "text-[#5f6368]"}`}><WayfindingIcon name={step.icon} size={20} /></span>}
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] leading-5 ${step.isTransition ? "font-semibold text-[#174ea6]" : "font-medium"}`}>{step.text}</span>
                {step.isTransition && step.subtext ? <span className="mt-0.5 block text-[13px] text-[#3c4043]">{step.subtext}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  function roomField(kind: "origin" | "destination") {
    const isOrigin = kind === "origin";
    const value = isOrigin ? originQuery : destinationQuery;
    const setValue = isOrigin ? setOriginQuery : setDestinationQuery;
    const focused = isOrigin ? originFocused : destFocused;
    const setFocused = isOrigin ? setOriginFocused : setDestFocused;
    const suggestions = isOrigin ? originSuggestions : destSuggestions;
    const pick = isOrigin ? selectOriginSuggestion : selectDestSuggestion;
    return (
      <div className="relative">
        <input
          aria-label={isOrigin ? "Start room" : "Destination room"}
          value={value}
          onChange={(e) => { setValue(e.target.value); setActiveRoute(null); setActiveLegIndex(null); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setFocused(false);
              calculateRoute();
            }
          }}
          placeholder={isOrigin ? "Choose a start room (e.g. W305)" : "Choose a destination (e.g. E303)"}
          className="h-11 w-full rounded-[10px] bg-black/5 pr-9 pl-3.5 text-[15px] font-medium text-[#1f1f1f] outline-none placeholder:font-normal placeholder:text-[#5f6368] focus:ring-2 focus:ring-[#5b238a]/30"
        />
        {value ? (
          <button type="button" aria-label={isOrigin ? "Clear start room" : "Clear destination"} onClick={() => { setValue(""); setActiveRoute(null); }} className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] hover:bg-black/10">
            <Glyph size={16}>{ICONS.close}</Glyph>
          </button>
        ) : null}
        {focused && suggestions.length > 0 ? (
          <div className={`absolute top-full right-0 left-0 z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl py-1 ${card}`}>
            <p className="px-3 py-1 text-[11px] font-bold tracking-wider text-[#5f6368] uppercase">
              {value.trim() ? "Matching locations" : "Popular places"}
            </p>
            {suggestions.map((sug) => (
              <button
                key={`${kind}-${sug.id}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(sug);
                }}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-[#5b238a]/10"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{sug.id}</span>
                  {sug.name && sug.name !== sug.id ? <span className="ml-1.5 text-[13px] text-[#5f6368]">{sug.name}</span> : null}
                </span>
                <span className="shrink-0 rounded bg-[#f1eaf7] px-1.5 py-0.5 text-[11px] font-semibold text-[#5b238a]">
                  {sug.building} · L{sug.level === 0 ? "C" : sug.level}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const routeTypeButton = (accessible: boolean) => (
    <button
      type="button"
      aria-pressed={accessibleOnly === accessible}
      onClick={() => {
        setAccessibleOnly(accessible);
        if (originQuery && destinationQuery) calculateRoute(originQuery, destinationQuery, accessible);
      }}
      className={`flex h-[38px] items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition ${accessibleOnly === accessible ? "bg-white text-[#5b238a] shadow-[0_1px_2px_rgba(0,0,0,.2)]" : "text-[#3c4043]"}`}
    >
      <Glyph size={18}>{accessible ? ICONS.accessible : ICONS.walk}</Glyph>{accessible ? "Step-free" : "Fastest"}
    </button>
  );

  const directionsPanel = (
    <section aria-label="Directions">
      <div className="flex items-center justify-between pt-2 pr-2 pl-4">
        <div role="group" aria-label="Route type" className="flex rounded-full bg-black/5 p-[3px]">
          {routeTypeButton(false)}
          {routeTypeButton(true)}
        </div>
        <button type="button" onClick={closeDirections} aria-label="Close directions" className={iconButton}><Glyph>{ICONS.close}</Glyph></button>
      </div>
      <div className="flex items-center gap-3 py-4 pr-2 pl-5">
        <div aria-hidden="true" className="flex w-5 flex-col items-center gap-1">
          <span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#1f1f1f]" />
          <span className="h-6 w-0.5 bg-[repeating-linear-gradient(#9aa0a6_0_3px,transparent_3px_6px)]" />
          <span className="text-[#5b238a]"><Glyph size={18}>{ICONS.pin}</Glyph></span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {roomField("origin")}
          {roomField("destination")}
        </div>
        <button type="button" onClick={swapRooms} title="Swap start and destination" aria-label="Swap start and destination" className={iconButton}><Glyph>{ICONS.swap}</Glyph></button>
      </div>
      {!activeRoute ? (
        <div className="px-5 pb-4">
          <button type="button" onClick={() => calculateRoute()} disabled={routeLoading || !originQuery || !destinationQuery} className="min-h-11 w-full rounded-full bg-[#5b238a] text-sm font-semibold text-white transition hover:bg-[#4b1d72] disabled:opacity-50">
            {routeLoading ? "Calculating…" : "Get directions"}
          </button>
        </div>
      ) : null}
      {routeError ? <p role="alert" className="mx-5 mb-4 rounded-xl bg-[#fce8e6] p-3 text-[13px] text-[#a50e0e]">{routeError}</p> : null}
      {activeRoute ? (
        <>
          <div className="flex items-center gap-4 border-t-8 border-black/5 px-6 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[22px] font-bold text-[#137333]">{routeMinutes} min <span className="text-[15px] font-medium text-[#5f6368]">· {Math.round(activeRoute.totalDistanceMeters)} m</span></p>
              <p className="mt-0.5 text-[13px] text-[#5f6368]">{activeRoute.fromRoom} → {activeRoute.toRoom} · {activeRoute.transitions.some((transition) => transition.type === "stairs") ? "Includes stairs" : "Step-free route"}</p>
            </div>
            <button type="button" onClick={() => selectLeg(0)} disabled={!activeRoute.legs.length} className="flex h-11 items-center gap-2 rounded-full bg-[#5b238a] px-5 text-[15px] font-semibold text-white hover:bg-[#4b1d72] disabled:opacity-40">
              <Glyph size={18}>{ICONS.start}</Glyph>Start
            </button>
          </div>
          <div className="border-t border-[#e8eaed]">{stepList}</div>
        </>
      ) : null}
    </section>
  );

  const signedInInitial = user?.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative h-dvh min-h-0 overflow-hidden bg-[#f2f2f0] text-[#1f1f1f]">
      <main className="absolute inset-0">
        <MapView
          buildingId={buildingId}
          floor={floor}
          panelOpen={panelVisible}
          selectedRoom={selectedRoom}
          onSelectRoom={handleMapRoomClick}
          activeRoute={activeRoute}
          activeLegIndex={activeLegIndex}
          directionMode={directionMode}
        />
      </main>

      {/* Fixed corner: bottom-left on desktop, top-left on phones (where guidance needs the full top width). */}
      <div className={`pointer-events-none absolute top-3 left-3 z-10 items-center rounded-xl px-3 py-2 md:top-auto md:bottom-4 md:left-4 md:flex ${card} ${navigating ? "hidden" : "flex"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hunter-logo.svg" alt="Hunter College" className="h-7 w-auto md:h-9" />
      </div>

      {!navigating ? (
        <div className="absolute top-4 left-[408px] z-20 hidden gap-2 md:flex">{categoryChips(true)}</div>
      ) : null}

      {!navigating ? (
        <button type="button" onClick={openContribute} aria-label={user ? `Account and contributions: ${user.name}` : "Sign in to contribute"} className={`absolute top-3 right-3 z-30 flex h-11 items-center justify-center rounded-full text-sm font-semibold text-white shadow-[0_1px_3px_rgba(60,64,67,.3)] md:top-4 md:right-4 ${user ? "w-11 bg-[#7b3fb0]" : "bg-[#5b238a] px-5 hover:bg-[#4b1d72]"}`}>
          {user ? signedInInitial : "Sign in"}
        </button>
      ) : null}

      <LevelControl
        levels={campusLevels}
        floor={floor}
        onSelect={selectFloor}
        buildingId={buildingId}
        onSelectBuilding={selectBuilding}
        onOutdoor={showOutdoor}
        routeLevels={routeLevels}
        className={navigating ? "top-[180px] md:top-4" : "top-[68px] md:top-[76px]"}
      />

      {panoramaRoom ? <PanoramaModal key={panoramaRoom.id} locationId={panoramaRoom.id} title={panoramaRoom.title} onClose={() => setPanoramaRoom(null)} /> : null}

      {!navigating || showSteps ? (
        <aside
          id="map-controls"
          aria-label="Search and places"
          className={`absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-[20px] border border-white/60 bg-white/75 shadow-[0_-2px_16px_rgba(0,0,0,.18)] backdrop-blur-md backdrop-saturate-150 ${sheetExpanded ? "max-h-[85dvh]" : "max-h-[46dvh]"} md:inset-x-auto md:top-4 md:bottom-auto md:left-4 md:max-h-[calc(100dvh-112px)] md:w-[380px] md:shadow-[0_1px_3px_rgba(60,64,67,.25),0_4px_12px_rgba(60,64,67,.12)] ${panelVisible ? "md:rounded-2xl" : "md:rounded-[24px]"}`}
        >
          <button type="button" onClick={() => setSheetExpanded(!sheetExpanded)} aria-label={sheetExpanded ? "Collapse panel" : "Expand panel"} aria-expanded={sheetExpanded} className="flex h-6 shrink-0 items-center justify-center md:hidden">
            <span className="h-[5px] w-9 rounded-full bg-[#c4c7c5]" />
          </button>

          {navigating ? (
            <>
              <div className="flex items-center gap-1 border-b border-[#e8eaed] py-2 pr-2 pl-5">
                <h2 className="flex-1 text-lg font-semibold">Steps to {activeRoute?.toRoom}</h2>
                <button type="button" onClick={() => setShowSteps(false)} aria-label="Hide steps" className={iconButton}><Glyph>{ICONS.close}</Glyph></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{stepList}</div>
            </>
          ) : panel === "directions" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">{directionsPanel}</div>
          ) : panel === "contribute" ? (
            <>
              <div className="flex items-center gap-1 border-b border-[#e8eaed] py-1 pr-2 pl-1">
                <button type="button" onClick={() => setPanel(selectedRoom ? "place" : null)} aria-label="Back" className={iconButton}><Glyph>{ICONS.back}</Glyph></button>
                <h2 className="flex-1 text-lg font-semibold">Contribute</h2>
                <button type="button" onClick={closeSearch} aria-label="Close" className={iconButton}><Glyph>{ICONS.close}</Glyph></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <UploadPanel graph={routingGraph} initialLocationId={selectedDetails?.roomId ?? selectedRoom} locationsError={locationsError} user={user} checkingSession={checkingSession} sessionError={sessionError} onUserChange={setUser} />
              </div>
            </>
          ) : (
            <>
              <div className={`flex h-12 shrink-0 items-center px-0.5 ${panelVisible ? "md:border-b md:border-[#e8eaed]" : ""}`}>
                {panel ? (
                  <button type="button" onClick={closeSearch} aria-label="Back to map" className={iconButton}><Glyph>{ICONS.back}</Glyph></button>
                ) : (
                  <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu" aria-expanded={menuOpen} className={iconButton}><Glyph>{ICONS.menu}</Glyph></button>
                )}
                <label htmlFor="room-search" className="sr-only">Search rooms or places</label>
                <input
                  id="room-search"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSelectedRoom(null); setPanel("results"); }}
                  onFocus={() => { setMenuOpen(false); if (!panel) setPanel("results"); setSheetExpanded(true); }}
                  onKeyDown={(event) => event.key === "Enter" && goToQuery()}
                  className="h-full min-w-0 flex-1 bg-transparent px-1 text-[15px] text-[#1f1f1f] outline-none placeholder:text-[#5f6368]"
                  placeholder="Search rooms, buildings, places"
                />
                {query || panel ? (
                  <button type="button" onClick={closeSearch} aria-label="Clear search" className={iconButton}><Glyph>{ICONS.close}</Glyph></button>
                ) : (
                  <button type="button" onClick={goToQuery} aria-label="Search" className={iconButton}><Glyph>{ICONS.search}</Glyph></button>
                )}
                <span className="h-6 w-px bg-[#dadce0]" />
                <button type="button" onClick={openDirections} aria-label="Directions" className={`${iconButton} text-[#5b238a]`}><Glyph>{ICONS.directions}</Glyph></button>
              </div>
              {error ? <p role="alert" className="px-5 pb-2 text-[13px] text-[#b3261e]">{error}</p> : null}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {menuOpen ? (
                  <ul aria-label="Menu" className="border-t border-[#e8eaed] py-1">
                    <li><button type="button" onClick={openDirections} className="flex min-h-12 w-full items-center gap-4 px-5 text-left text-[15px] hover:bg-[#5b238a]/10"><span className="text-[#5b238a]"><Glyph>{ICONS.directions}</Glyph></span>Directions</button></li>
                    <li><button type="button" onClick={openContribute} className="flex min-h-12 w-full items-center gap-4 px-5 text-left text-[15px] hover:bg-[#5b238a]/10"><span className="text-[#5b238a]"><Glyph>{ICONS.upload}</Glyph></span>Contribute a 360° photo</button></li>
                  </ul>
                ) : null}
                {panel === "place" && selectedRoom ? (
                  <RoomCard key={selectedRoom} id={selectedRoom} locationId={selectedDetails?.roomId ?? selectedRoom} name={selectedInfo?.name ?? selectedRoom} building={buildingName(selectedInfo?.building ?? buildingId ?? "")} level={selectedInfo?.level ?? floor ?? 1} stepFree={elevatorFloors.has(`${selectedInfo?.building}:${selectedInfo?.level}`)} media={ROOM_MEDIA[selectedDetails?.roomId ?? selectedRoom]} onClose={closeSearch} onDirections={() => startDirectionsTo(selectedRoom)} onFrom={() => startDirectionsFrom(selectedRoom)} onPanorama={() => setPanoramaRoom({ id: selectedDetails?.roomId ?? selectedRoom, title: selectedInfo?.name ?? selectedRoom })} onUpload={openContribute} />
                ) : (
                  <div className={panel ? "" : "md:hidden"}>
                    <div className="flex gap-2 overflow-x-auto px-4 pt-2 pb-1 [scrollbar-width:none] md:hidden">{categoryChips(false)}</div>
                    {resultsList}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      ) : null}

      {navigating && currentStep ? (
        <section aria-label="Current step" aria-live="polite" className={`absolute inset-x-2.5 top-3 z-30 overflow-hidden rounded-[18px] shadow-[0_4px_16px_rgba(0,0,0,.25)] backdrop-blur-md md:right-auto md:top-4 md:w-[440px] ${showSteps ? "md:left-[408px]" : "md:left-4"}`}>
          <div className="flex items-center gap-4 bg-[#3d1760]/85 p-4 text-white md:px-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-white/15"><WayfindingIcon name={currentStep.icon} size={30} /></span>
            <div className="min-w-0">
              <p className="text-xl leading-tight font-bold md:text-[22px]">{currentStep.text}</p>
              {currentStep.subtext ? <p className="mt-1 text-sm text-[#e3d6f0]">{currentStep.subtext}</p> : null}
            </div>
          </div>
          {thenStep ? (
            <p className="flex items-center gap-2.5 bg-[#2a0f45]/85 px-4 py-2.5 text-sm text-[#e3d6f0] md:px-5">
              <span className="font-semibold text-white">Then</span><WayfindingIcon name={thenStep.icon} size={18} />{thenStep.text}
            </p>
          ) : null}
        </section>
      ) : null}

      {navigating ? (
        <section aria-label="Trip summary" className={`absolute inset-x-0 bottom-0 z-30 flex-col gap-3.5 rounded-t-[20px] border border-white/60 bg-white/75 px-4 pt-4 pb-7 shadow-[0_-2px_16px_rgba(0,0,0,.18)] backdrop-blur-md backdrop-saturate-150 md:inset-x-auto md:bottom-6 md:w-[640px] md:flex-row md:items-center md:gap-5 md:rounded-[20px] md:py-3.5 md:pr-4 md:pl-6 md:shadow-[0_1px_3px_rgba(60,64,67,.25),0_4px_12px_rgba(60,64,67,.12)] ${showSteps ? "hidden md:left-[408px] md:flex" : "flex md:left-1/2 md:-translate-x-1/2"}`}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-[22px] font-bold text-[#137333]">{routeMinutes} min <span className="text-[15px] font-medium text-[#5f6368]">· {Math.round(activeRoute?.totalDistanceMeters ?? 0)} m · Step {legNumber} of {legs.length}</span></p>
              <button type="button" onClick={closeDirections} className="h-12 rounded-full bg-[#fce8e6] px-5 text-[15px] font-semibold text-[#a50e0e] md:hidden">End</button>
            </div>
            <div aria-hidden="true" className="mt-2.5 flex gap-1">
              {legs.map((_, index) => <span key={index} className={`h-1 flex-1 rounded-sm ${index < legNumber ? "bg-[#5b238a]" : "bg-[#dadce0]"}`} />)}
            </div>
          </div>
          <div className="flex gap-2.5">
            <button type="button" onClick={() => setShowSteps(true)} aria-label="Show all steps" className="flex h-12 w-12 items-center justify-center rounded-full border border-[#dadce0] text-[#3c4043]"><Glyph>{ICONS.list}</Glyph></button>
            <button type="button" onClick={goToPrevStep} disabled={activeLegIndex === 0} aria-label="Previous step" className="flex h-12 w-12 items-center justify-center rounded-full border border-[#dadce0] text-[#3c4043] disabled:opacity-35"><Glyph>{ICONS.prev}</Glyph></button>
            {lastLeg ? (
              <button type="button" onClick={closeDirections} className="h-12 flex-1 rounded-full bg-[#5b238a] px-6 text-[15px] font-semibold text-white md:flex-none">Finish</button>
            ) : (
              <button type="button" onClick={goToNextStep} aria-label="Next step" className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#5b238a] px-5 text-[15px] font-semibold text-white md:flex-none">Next<Glyph>{ICONS.next}</Glyph></button>
            )}
            <button type="button" onClick={closeDirections} className="hidden h-12 rounded-full bg-[#fce8e6] px-5 text-[15px] font-semibold text-[#a50e0e] md:block">End</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
