"use client";

import dynamic from "next/dynamic";
import { RoomCard } from "./RoomCard";
import { LevelControl } from "./LevelControl";
import { WayfindingIcon, type WayfindingIconName } from "./WayfindingIcon";
import { ROOM_MEDIA } from "@/lib/roomMedia";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  campusLevelsForSelection,
  type CampusBuildingId,
  closestCampusLevel,
} from "@/lib/campusLevels";
import { canonicalRoomId, parseRoomId } from "@/lib/parseRoomId";
import {
  fetchRoutingGraph,
  findRoute,
  resolveRoom,
  type RouteLeg,
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

export function CampusApp() {
  const [tab, setTab] = useState<"explore" | "directions">("explore");
  const [buildingId, setBuildingId] = useState<CampusBuildingId | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const [panoramasOnly, setPanoramasOnly] = useState(false);

  // Directions state
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [originFocused, setOriginFocused] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [activeRoute, setActiveRoute] = useState<RouteResult | null>(null);
  const [activeLegIndex, setActiveLegIndex] = useState<number | null>(null);
  const navigating = activeRoute != null && activeLegIndex != null;
  const activeStepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeLegIndex]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routingGraph, setRoutingGraph] = useState<RoutingGraphData | null>(null);

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
      .catch((err) => console.warn("Failed to prefetch routing graph:", err));
  }, []);

  const roomKeys = useMemo(
    () => (routingGraph ? Object.keys(routingGraph.rooms).sort() : []),
    [routingGraph]
  );

  const searchTerm = query.trim().toLowerCase();
  const exploreResults = roomKeys.filter((id) => {
    const room = routingGraph!.rooms[id];
    const term = searchTerm;
    return (!panoramasOnly || Boolean(ROOM_MEDIA[id]?.panorama)) &&
      (!buildingId || room.building === buildingId) &&
      (!term || `${id} ${room.name}`.toLowerCase().includes(term));
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
  }

  const getSuggestions = (queryText: string, isFocused: boolean): RoomSuggestion[] => {
    if (!routingGraph || !isFocused) return [];
    const q = queryText.trim().toUpperCase();
    if (!q) {
      const popular = ["W305", "E303", "N11007", "W502", "B201", "BTB105"];
      return popular
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
      const bName = BUILDINGS.find((b) => b.id === leg.building)?.name ?? `${leg.building} Building`;
      const levelText = leg.level === 0 ? "Concourse" : `Level ${leg.level}`;

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
          subtext: `Less than a minute`,
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

  const directionMode = tab === "directions" || Boolean(activeRoute);

  const legBuildingName =
    activeRoute && activeLegIndex != null && activeRoute.legs[activeLegIndex]
      ? BUILDINGS.find((b) => b.id === activeRoute.legs[activeLegIndex].building)?.name
      : null;

  const buildingName = BUILDINGS.find((building) => building.id === buildingId)?.name;
  const levelName = floor === 0 ? "Concourse" : `Level ${floor}`;
  const mapStatus =
    floor == null
      ? "Outdoor"
      : directionMode && activeRoute && activeLegIndex != null
        ? `${legBuildingName ?? "All buildings"} · ${levelName} · Leg ${activeLegIndex + 1}`
        : `${buildingName ?? "All buildings"} · ${levelName}`;
  const campusLevels = campusLevelsForSelection(buildingId);

  function showOutdoor() {
    setBuildingId(null);
    setFloor(null);
    setSelectedRoom(null);
    setError(null);
  }

  function selectBuilding(id: CampusBuildingId) {
    setBuildingId(id);
    setFloor((currentFloor) => closestCampusLevel(id, currentFloor ?? 1));
    setSelectedRoom(null);
    setError(null);
  }

  function selectAllBuildings() {
    setBuildingId(null);
    setFloor((currentFloor) => currentFloor ?? 1);
    setSelectedRoom(null);
    setError(null);
  }

  function selectFloor(level: number) {
    setFloor(level);
    setSelectedRoom(null);
    setError(null);
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

  function startDirectionsFrom(roomId: string) {
    setTab("directions");
    setPanelOpen(true);
    setOriginQuery(roomId);
    if (destinationQuery && destinationQuery !== roomId) {
      calculateRoute(roomId, destinationQuery);
    }
  }

  function startDirectionsTo(roomId: string) {
    setTab("directions");
    setPanelOpen(true);
    setDestinationQuery(roomId);
    if (originQuery && originQuery !== roomId) {
      calculateRoute(originQuery, roomId);
    }
  }

  function handleMapRoomClick(roomId: string) {
    if (navigating) return;
    setSelectedRoom(roomId);
    if (tab === "explore") {
      setQuery(roomId);
      setError(null);
    } else {
      if (!originQuery) {
        setOriginQuery(roomId);
      } else if (!destinationQuery) {
        setDestinationQuery(roomId);
        calculateRoute(originQuery, roomId);
      } else {
        setDestinationQuery(roomId);
        calculateRoute(originQuery, roomId);
      }
    }
  }

  // Compute direction steps for the active route
  const directionSteps = useMemo(
    () => (activeRoute ? generateDirectionSteps(activeRoute) : []),
    [activeRoute]
  );

  return (
    <div className="relative h-dvh min-h-0 overflow-hidden bg-[#f4f3ef] text-[#41434a]">
      <main className="absolute inset-0">
        <MapView
          buildingId={buildingId}
          floor={floor}
          panelOpen={panelOpen}
          selectedRoom={selectedRoom}
          onSelectRoom={handleMapRoomClick}
          activeRoute={activeRoute}
          activeLegIndex={activeLegIndex}
          directionMode={directionMode}
        />
        <div className={`${selectedRoom && tab === "explore" ? "hidden md:block" : ""} pointer-events-none absolute bottom-12 left-3 z-10 max-w-[calc(100%-6rem)] rounded-2xl bg-white/65 px-4 py-3 text-sm font-medium shadow-[0_8px_30px_rgba(39,38,44,0.14)] backdrop-blur-[3px] md:top-5 md:right-24 md:bottom-auto md:left-auto`}>
          {mapStatus}
        </div>
      </main>

      {selectedRoom && tab === "explore" ? <RoomCard key={selectedRoom} id={selectedRoom} name={selectedInfo?.name ?? selectedRoom} building={BUILDINGS.find((b) => b.id === (selectedInfo?.building ?? buildingId))?.name ?? "Campus"} level={selectedInfo?.level ?? floor ?? 1} media={ROOM_MEDIA[selectedDetails?.roomId ?? selectedRoom]} onClose={() => { setSelectedRoom(null); setQuery(""); }} onDirections={() => startDirectionsTo(selectedRoom)} onFrom={() => startDirectionsFrom(selectedRoom)} /> : null}

      <LevelControl levels={campusLevels} floor={floor} onSelect={selectFloor} />

      {panelOpen ? (
        <aside
          id="map-controls"
          style={selectedRoom && tab === "explore" ? { maxHeight: "calc(60dvh - 5rem)" } : undefined}
          className="[&>*]:shrink-0 absolute top-3 right-20 left-3 z-20 flex max-h-[60dvh] flex-col overflow-y-auto rounded-[26px] border border-white/65 bg-white/60 p-4 shadow-[0_18px_55px_rgba(39,38,44,0.17)] backdrop-blur-[3px] md:top-5 md:right-auto md:left-5 md:max-h-[calc(100dvh-2.5rem)] md:w-[340px]"
        >
          {navigating ? (
            <header>
              <button type="button" onClick={() => setActiveLegIndex(null)} className="rounded-lg px-2 py-2 text-sm font-semibold text-[#5b238a]">← Back</button>
              <h1 className="mt-2 text-base font-semibold text-[#2f3137]">Directions to {activeRoute.toRoom}</h1>
              <p className="mt-0.5 text-xs text-[#555861]">{Math.max(1, Math.ceil(activeRoute.estimatedSeconds / 60))} minute total</p>

              {/* ── Route progress bar ── */}
              <div className="mt-3 flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#10b981]" title="Start" />
                <div className="flex flex-1 items-center">
                  {activeRoute.transitions.length === 0 ? (
                    <div className="h-0.5 flex-1 rounded bg-[#5b238a]" />
                  ) : (
                    activeRoute.transitions.map((t, ti) => (
                      <div key={ti} className="flex flex-1 items-center">
                        <div className={`h-0.5 flex-1 rounded ${activeLegIndex != null && activeLegIndex > ti ? "bg-[#5b238a]" : "bg-[#d4d0da]"}`} />
                        <span className={`mx-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${activeLegIndex != null && activeLegIndex === ti ? "bg-[#f9cc45] ring-2 ring-[#f59e0b]" : "bg-[#f1edf4]"}`} title={t.description}>
                          <WayfindingIcon name={t.type} size={13} />
                        </span>
                        <div className={`h-0.5 flex-1 rounded ${activeLegIndex != null && activeLegIndex > ti ? "bg-[#5b238a]" : "bg-[#d4d0da]"}`} />
                      </div>
                    ))
                  )}
                </div>
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" title="Destination" />
              </div>
            </header>
          ) : <>
          <header className="relative">
            <div className="pr-16">
              <p className="text-sm font-semibold text-[#5b238a]">Hunter College</p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[#2f3137]">
                Campus wayfinding
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Hide map controls"
              aria-controls="map-controls"
              className="absolute top-0 right-0 rounded-full bg-[#f1edf4] px-3 py-1.5 text-xs font-semibold text-[#5b238a] transition hover:bg-[#e8dfee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b238a]"
            >
              Hide
            </button>
          </header>

          {/* Tab switcher */}
          <div className="mt-4 flex rounded-xl bg-[#f1edf4] p-1 text-xs font-semibold text-[#5b238a]">
            <button
              type="button"
              onClick={() => { setTab("explore"); setActiveRoute(null); setActiveLegIndex(null); }}
              aria-pressed={tab === "explore"}
              className={`flex-1 rounded-lg py-1.5 transition focus-visible:outline-2 focus-visible:outline-[#5b238a] ${
                tab === "explore"
                  ? "bg-white text-[#4b1d72] shadow-sm"
                  : "text-[#6c5580] hover:text-[#4b1d72]"
              }`}
            >
              Explore
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("directions");
                setBuildingId(null);
                if (selectedRoom && !originQuery) {
                  setOriginQuery(selectedRoom);
                  if (destinationQuery && destinationQuery !== selectedRoom) {
                    calculateRoute(selectedRoom, destinationQuery);
                  }
                }
              }}
              aria-pressed={tab === "directions"}
              className={`flex-1 rounded-lg py-1.5 transition focus-visible:outline-2 focus-visible:outline-[#5b238a] ${
                tab === "directions"
                  ? "bg-white text-[#4b1d72] shadow-sm"
                  : "text-[#6c5580] hover:text-[#4b1d72]"
              }`}
            >
              Directions {activeRoute ? "•" : ""}
            </button>
          </div>

          </>}

          {tab === "explore" ? (
            <>
              <label className="mt-4 block text-sm font-medium text-[#4c4f56]" htmlFor="room-search">
                Search rooms or places
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="room-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && goToQuery()}
                  className="min-w-0 flex-1 rounded-xl border border-[#dedfe3] bg-white/65 px-3.5 py-2.5 text-sm text-[#2f3137] outline-none transition placeholder:text-[#92959d] focus:border-[#5b238a] focus:ring-2 focus:ring-[#5b238a]/15"
                  placeholder="Room number or place name"
                />
                <button
                  type="button"
                  onClick={goToQuery}
                  className="rounded-xl bg-[#5b238a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4b1d72] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b238a]"
                >
                  Go
                </button>
              </div>
              {error ? <p className="mt-2 text-sm text-[#b3261e]">{error}</p> : null}

              <button type="button" aria-pressed={panoramasOnly} onClick={() => { setPanoramasOnly(!panoramasOnly); setQuery(""); }} className={`mt-3 w-fit rounded-full border px-3 py-1.5 text-xs font-semibold ${panoramasOnly ? "border-[#5b238a] bg-[#5b238a] text-white" : "border-[#5b238a]/25 bg-white/45 text-[#5b238a]"}`}>
                360° locations
              </button>
              {panoramasOnly || (query.trim() && query !== selectedRoom) ? (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-xl bg-white/60" aria-label="Matching locations">
                  {!routingGraph ? <p className="p-3 text-xs">Loading locations…</p> : exploreResults.length ? exploreResults.slice(0, 20).map((id) => (
                    <button key={id} type="button" onClick={() => selectExploreRoom(id)} className="flex w-full items-center justify-between gap-2 border-b border-[#5b238a]/10 px-3 py-2 text-left text-sm hover:bg-white/70">
                      <span><span className="font-semibold">{id}</span><span className="ml-2 text-xs">{routingGraph.rooms[id].name !== id ? routingGraph.rooms[id].name : ""}</span></span>
                      {ROOM_MEDIA[id]?.panorama ? <span className="rounded-full bg-[#5b238a]/10 px-2 py-1 text-xs text-[#5b238a]">360°</span> : null}
                    </button>
                  )) : <p role="status" className="p-3 text-xs leading-5">{panoramasOnly ? "No 360° locations here yet. Turn off the filter to find rooms and get directions." : "No matching locations. Try another room number or building."}</p>}
                </div>
              ) : null}

              <label htmlFor="building-select" className="mt-4 block text-sm font-semibold">Building</label>
              <select id="building-select" value={floor == null ? "outdoor" : buildingId ?? "all"} onChange={(event) => {
                const value = event.target.value;
                if (value === "outdoor") showOutdoor();
                else if (value === "all") selectAllBuildings();
                else selectBuilding(value as CampusBuildingId);
              }} className="mt-2 w-full rounded-xl border border-[#dedfe3] bg-white/60 px-3 py-2.5 text-sm">
                <option value="outdoor">Outdoor campus</option>
                <option value="all">All buildings</option>
                {BUILDINGS.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
              </select>




            </>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {!navigating ? <>
              {/* Directions inputs */}
              <div className="relative flex flex-col gap-2 rounded-2xl border border-[#dedfe3] bg-white/50 p-3 shadow-xs">
                {/* Origin Input */}
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#10b981]" title="Start" />
                    <input
                      aria-label="Start room"
                      value={originQuery}
                      onChange={(e) => { setOriginQuery(e.target.value); setActiveRoute(null); setActiveLegIndex(null); }}
                      onFocus={() => setOriginFocused(true)}
                      onBlur={() => setTimeout(() => setOriginFocused(false), 200)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setOriginFocused(false);
                          calculateRoute();
                        }
                      }}
                      placeholder="Start room (e.g. W305)"
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#2f3137] outline-none placeholder:text-[#92959d]"
                    />
                    {originQuery ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOriginQuery("");
                          setActiveRoute(null);
                        }}
                        className="px-1 text-xs text-[#92959d] hover:text-[#2f3137]"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>

                  {originFocused && originSuggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-[#dedfe3] bg-white py-1 shadow-lg">
                      <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#92959d]">
                        {originQuery.trim() ? "Matching Locations" : "Quick suggestions"}
                      </p>
                      {originSuggestions.map((sug) => (
                        <button
                          key={`orig-${sug.id}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectOriginSuggestion(sug);
                          }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-[#f1edf4]"
                        >
                          <div>
                            <span className="font-bold text-[#2f3137]">{sug.id}</span>
                            {sug.name && sug.name !== sug.id ? (
                              <span className="ml-1.5 text-[11px] text-[#747780]">({sug.name})</span>
                            ) : null}
                          </div>
                          <span className="rounded bg-[#f1edf4] px-1.5 py-0.5 text-[10px] font-semibold text-[#5b238a]">
                            {sug.building} · L{sug.level === 0 ? "C" : sug.level}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="relative my-0.5 border-t border-[#e8e9ed]">
                  <button
                    type="button"
                    onClick={swapRooms}
                    title="Swap start and destination"
                    aria-label="Swap start and destination"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full border border-[#dedfe3] bg-white p-1 text-xs text-[#5b238a] shadow-sm transition hover:bg-[#f1edf4]"
                  >
                    ⇅
                  </button>
                </div>

                {/* Destination Input */}
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" title="Destination" />
                    <input
                      aria-label="Destination room"
                      value={destinationQuery}
                      onChange={(e) => { setDestinationQuery(e.target.value); setActiveRoute(null); setActiveLegIndex(null); }}
                      onFocus={() => setDestFocused(true)}
                      onBlur={() => setTimeout(() => setDestFocused(false), 200)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setDestFocused(false);
                          calculateRoute();
                        }
                      }}
                      placeholder="Destination room (e.g. E303)"
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#2f3137] outline-none placeholder:text-[#92959d]"
                    />
                    {destinationQuery ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDestinationQuery("");
                          setActiveRoute(null);
                        }}
                        className="px-1 text-xs text-[#92959d] hover:text-[#2f3137]"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>

                  {destFocused && destSuggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-[#dedfe3] bg-white py-1 shadow-lg">
                      <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#92959d]">
                        {destinationQuery.trim() ? "Matching Locations" : "Quick suggestions"}
                      </p>
                      {destSuggestions.map((sug) => (
                        <button
                          key={`dest-${sug.id}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectDestSuggestion(sug);
                          }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-[#f1edf4]"
                        >
                          <div>
                            <span className="font-bold text-[#2f3137]">{sug.id}</span>
                            {sug.name && sug.name !== sug.id ? (
                              <span className="ml-1.5 text-[11px] text-[#747780]">({sug.name})</span>
                            ) : null}
                          </div>
                          <span className="rounded bg-[#f1edf4] px-1.5 py-0.5 text-[10px] font-semibold text-[#5b238a]">
                            {sug.building} · L{sug.level === 0 ? "C" : sug.level}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Accessible toggle */}
              <label className="flex cursor-pointer items-center gap-2.5 px-1 text-xs font-medium text-[#555861]">
                <input
                  type="checkbox"
                  checked={accessibleOnly}
                  onChange={(e) => {
                    setAccessibleOnly(e.target.checked);
                    if (originQuery && destinationQuery) {
                      calculateRoute(originQuery, destinationQuery, e.target.checked);
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-[#5b238a] focus:ring-[#5b238a]"
                />
                <span>Wheelchair accessible (step-free, avoid stairs)</span>
              </label>

              {/* Action buttons */}
              <div className="flex gap-2">
                {!activeRoute ? <button
                  type="button"
                  onClick={() => calculateRoute()}
                  disabled={routeLoading || !originQuery || !destinationQuery}
                  className="flex-1 rounded-xl bg-[#5b238a] py-2.5 text-sm font-semibold text-white transition hover:bg-[#4b1d72] disabled:opacity-50"
                >
                  {routeLoading ? "Calculating…" : "Get Directions"}
                </button> : null}
                {activeRoute || originQuery || destinationQuery ? (
                  <button
                    type="button"
                    onClick={clearRoute}
                    className="rounded-xl border border-[#dedfe3] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#555861] transition hover:bg-[#f7f8f9]"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {routeError ? (
                <div className="rounded-xl border border-[#fca5a5] bg-[#fef2f2] p-3 text-xs text-[#991b1b]">
                  {routeError}
                </div>
              ) : null}

              </> : null}

              {/* Route preview requires an explicit Start before guidance. */}
              {activeRoute && !navigating ? (
                <section aria-label="Route preview" className="rounded-2xl border border-[#e5dfeb] bg-white/65 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[#2f3137]">{Math.max(1, Math.ceil(activeRoute.estimatedSeconds / 60))} min · {Math.round(activeRoute.totalDistanceMeters)} m</p>
                    <button type="button" onClick={() => selectLeg(0)} disabled={!activeRoute.legs.length} className="rounded-full bg-[#5b238a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4b1d72] disabled:opacity-40">Start</button>
                  </div>
                  <p className="mt-2 text-xs text-[#555861]">{activeRoute.fromRoom} → {activeRoute.toRoom}</p>
                  <p className="mt-1 text-xs text-[#555861]">{activeRoute.transitions.some((transition) => transition.type === "stairs") ? "Includes stairs" : "Step-free route"}</p>
                </section>
              ) : null}

              {/* ── Mappedin-style turn-by-turn directions ── */}
              {activeRoute && navigating ? (
                <section aria-label="Step-by-step directions" className="flex flex-col gap-3">
                  {/* Origin section header */}
                  <div className="flex items-center gap-2 px-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-[#10b981]" />
                    <span className="text-sm font-bold text-[#2f3137]">{activeRoute.fromRoom}</span>
                  </div>

                  {/* Step list */}
                  <ol className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "calc(40dvh - 2rem)" }}>
                    {directionSteps.map((step, si) => {
                      const isCurrent = step.legIndex === activeLegIndex;
                      const isHighlighted = step.isTransition;

                      return (
                        <li key={si}>
                          <button
                            ref={isCurrent && !step.isTransition ? activeStepRef : undefined}
                            type="button"
                            onClick={() => selectLeg(step.legIndex)}
                            aria-current={isCurrent ? "step" : undefined}
                            className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                              isHighlighted
                                ? "bg-[#f9cc45] text-[#30291a]"
                                : isCurrent
                                  ? "bg-[#f1edf4] text-[#2f3137] ring-1 ring-[#5b238a]/20"
                                  : "bg-white/40 text-[#555861] hover:bg-white/70"
                            }`}
                          >
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm" aria-hidden="true">
                              <WayfindingIcon name={step.icon} size={19} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="block text-sm font-medium leading-5">{step.text}</span>
                              {step.subtext ? (
                                <span className={`mt-0.5 block text-xs ${isHighlighted ? "text-[#5e4a1a]" : "text-[#92959d]"}`}>{step.subtext}</span>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ol>

                  {/* Destination section header */}
                  <div className="flex items-center gap-2 px-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-[#f59e0b]" />
                    <span className="text-sm font-bold text-[#2f3137]">{activeRoute.toRoom}</span>
                  </div>

                  {/* Navigation buttons */}
                  <div className="sticky bottom-0 flex gap-3 rounded-xl bg-white/90 p-2">
                    <button type="button" onClick={goToPrevStep} disabled={activeLegIndex === 0} className="flex-1 rounded-xl border border-[#dedfe3] px-3 py-2.5 text-sm font-semibold text-[#555861] disabled:opacity-35">←</button>
                    {activeLegIndex === activeRoute.legs.length - 1 ? (
                      <button type="button" onClick={() => { clearRoute(); setTab("explore"); }} className="flex-1 rounded-xl bg-[#5b238a] px-3 py-2.5 text-sm font-semibold text-white">Finish</button>
                    ) : (
                      <button type="button" onClick={goToNextStep} className="flex-1 rounded-xl bg-[#5b238a] px-3 py-2.5 text-sm font-semibold text-white">→</button>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-controls="map-controls"
          aria-expanded={false}
          className="absolute top-4 left-4 z-20 rounded-full bg-[#5b238a] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(39,38,44,0.2)] transition hover:bg-[#4b1d72] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:top-5 md:left-5"
        >
          Wayfinding controls
        </button>
      )}
    </div>
  );
}
