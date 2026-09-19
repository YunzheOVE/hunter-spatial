"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
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

  // Directions state
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [originFocused, setOriginFocused] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [activeRoute, setActiveRoute] = useState<RouteResult | null>(null);
  const [activeLegIndex, setActiveLegIndex] = useState<number | null>(null);
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
    for (const key of roomKeys) {
      const r = routingGraph.rooms[key];
      if (!r) continue;
      const matchKey = key.toUpperCase().includes(q);
      const matchName = r.name && r.name.toUpperCase().includes(q);
      if (matchKey || matchName) {
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

  function getLegInstruction(
    leg: RouteLeg,
    index: number,
    totalLegs: number,
    fromRoom: string,
    toRoom: string
  ): string {
    const bName = BUILDINGS.find((b) => b.id === leg.building)?.name ?? `${leg.building} Building`;
    const levelText = leg.level === 0 ? "Concourse" : `Level ${leg.level}`;

    if (totalLegs === 1) {
      return `Walk along ${levelText} corridor directly from ${fromRoom} to ${toRoom}.`;
    }
    if (index === 0) {
      return `Depart from ${fromRoom} and follow the ${levelText} hallway in ${bName}.`;
    }
    if (index === totalLegs - 1) {
      return `Continue along ${levelText} in ${bName} to arrive at ${toRoom}.`;
    }
    return `Walk along ${levelText} corridor across ${bName}.`;
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
      const parsed = parseRoomId(query);
      const roomId = canonicalRoomId(parsed);
      setError(null);
      setBuildingId(parsed.buildingId);
      setFloor(parsed.floor || 1);
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
      setActiveLegIndex(0);

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
    setOriginQuery(roomId);
    if (destinationQuery && destinationQuery !== roomId) {
      calculateRoute(roomId, destinationQuery);
    }
  }

  function startDirectionsTo(roomId: string) {
    setTab("directions");
    setDestinationQuery(roomId);
    if (originQuery && originQuery !== roomId) {
      calculateRoute(originQuery, roomId);
    }
  }

  function handleMapRoomClick(roomId: string) {
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
        <div className="pointer-events-none absolute top-4 right-4 z-10 max-w-[calc(100%-2rem)] rounded-2xl bg-white/95 px-4 py-3 text-sm font-medium shadow-[0_8px_30px_rgba(39,38,44,0.14)] backdrop-blur md:top-5 md:right-5">
          {mapStatus}
        </div>
      </main>

      {panelOpen ? (
        <aside
          id="map-controls"
          className="absolute top-3 right-3 left-3 z-20 flex max-h-[72dvh] flex-col overflow-y-auto rounded-[26px] border border-black/5 bg-white/95 p-5 shadow-[0_18px_55px_rgba(39,38,44,0.17)] backdrop-blur md:top-5 md:right-auto md:left-5 md:max-h-[calc(100dvh-2.5rem)] md:w-[380px]"
        >
          <header className="relative">
            <div className="pr-16">
              <p className="text-sm font-semibold text-[#5b238a]">Hunter College</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-[#2f3137]">
                Campus wayfinding
              </h1>
              <p className="mt-1.5 text-xs leading-4 text-[#747780]">
                Interactive 3D indoor routing and building explorer.
              </p>
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
              onClick={() => setTab("explore")}
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
              className={`flex-1 rounded-lg py-1.5 transition focus-visible:outline-2 focus-visible:outline-[#5b238a] ${
                tab === "directions"
                  ? "bg-white text-[#4b1d72] shadow-sm"
                  : "text-[#6c5580] hover:text-[#4b1d72]"
              }`}
            >
              Directions {activeRoute ? "•" : ""}
            </button>
          </div>

          {tab === "explore" ? (
            <>
              <label className="mt-4 block text-sm font-medium text-[#4c4f56]" htmlFor="room-search">
                Room
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="room-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && goToQuery()}
                  className="min-w-0 flex-1 rounded-xl border border-[#dedfe3] bg-[#f5f6f8] px-3.5 py-2.5 text-sm text-[#2f3137] outline-none transition placeholder:text-[#92959d] focus:border-[#5b238a] focus:ring-2 focus:ring-[#5b238a]/15"
                  placeholder="e.g. N11007, W305, E303"
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

              {selectedRoom ? (
                <div className="mt-4 rounded-2xl border border-[#e5dfeb] bg-[#faf8fc] p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#5b238a]">Selected Room</p>
                      <p className="text-base font-bold text-[#2f3137]">{selectedRoom}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => startDirectionsFrom(selectedRoom)}
                      className="flex-1 rounded-xl bg-[#f1edf4] py-1.5 text-xs font-semibold text-[#5b238a] transition hover:bg-[#e8dfee]"
                    >
                      Directions from
                    </button>
                    <button
                      type="button"
                      onClick={() => startDirectionsTo(selectedRoom)}
                      className="flex-1 rounded-xl bg-[#5b238a] py-1.5 text-xs font-semibold text-white transition hover:bg-[#4b1d72]"
                    >
                      Directions to
                    </button>
                  </div>
                </div>
              ) : null}

              <section className="mt-5" aria-labelledby="building-heading">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="building-heading" className="text-sm font-semibold text-[#4c4f56]">Buildings</h2>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllBuildings}
                      aria-pressed={floor != null && buildingId == null}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b238a] ${
                        floor != null && buildingId == null
                          ? "bg-[#5b238a] text-white"
                          : "bg-[#f1edf4] text-[#5b238a] hover:bg-[#e8dfee]"
                      }`}
                    >
                      All buildings
                    </button>
                    <button
                      type="button"
                      onClick={showOutdoor}
                      aria-pressed={floor == null}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b238a] ${
                        floor == null ? "bg-[#5b238a] text-white" : "bg-[#f1edf4] text-[#5b238a] hover:bg-[#e8dfee]"
                      }`}
                    >
                      Outdoor
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {BUILDINGS.map((building) => (
                    <button
                      key={building.id}
                      type="button"
                      onClick={() => selectBuilding(building.id)}
                      aria-pressed={buildingId === building.id}
                      className={`min-h-16 rounded-xl border px-3 py-2.5 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b238a] ${
                        buildingId === building.id
                          ? "border-[#5b238a] bg-[#f1edf4] text-[#4b1d72]"
                          : "border-[#e2e3e7] bg-[#f7f8f9] text-[#555861] hover:border-[#c8c9cf] hover:bg-white"
                      }`}
                    >
                      <span className="block font-semibold">{building.id}</span>
                      <span className="mt-0.5 block text-xs leading-4 text-[#747780]">{building.name}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-5" aria-labelledby="floor-heading">
                <h2 id="floor-heading" className="text-sm font-semibold text-[#4c4f56]">Campus level</h2>
                <div className="mt-2 grid grid-cols-6 gap-1.5">
                  {campusLevels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => selectFloor(level)}
                      aria-label={level === 0 ? "Concourse" : `Level ${level}`}
                      aria-pressed={floor === level}
                      className={`rounded-lg py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5b238a] ${
                        floor === level
                          ? "bg-[#5b238a] text-white"
                          : "bg-[#f2f3f5] text-[#555861] hover:bg-[#e7e8eb]"
                      }`}
                    >
                      {level === 0 ? "C" : level}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {/* Directions inputs */}
              <div className="relative flex flex-col gap-2 rounded-2xl border border-[#dedfe3] bg-[#fafafc] p-3 shadow-xs">
                {/* Origin Input */}
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#10b981]" title="Start" />
                    <input
                      aria-label="Start room"
                      value={originQuery}
                      onChange={(e) => setOriginQuery(e.target.value)}
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
                      onChange={(e) => setDestinationQuery(e.target.value)}
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
                <button
                  type="button"
                  onClick={() => calculateRoute()}
                  disabled={routeLoading || !originQuery || !destinationQuery}
                  className="flex-1 rounded-xl bg-[#5b238a] py-2.5 text-sm font-semibold text-white transition hover:bg-[#4b1d72] disabled:opacity-50"
                >
                  {routeLoading ? "Calculating…" : "Get Directions"}
                </button>
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

              {/* Route overview & step-by-step legs */}
              {activeRoute ? (
                <div className="mt-2 flex flex-col gap-3">
                  {/* Route Summary Card */}
                  <div className="rounded-2xl border border-[#e5dfeb] bg-[#faf8fc] p-3.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#5b238a]">
                        {activeRoute.fromRoom} → {activeRoute.toRoom}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          accessibleOnly || activeRoute.transitions.every((t) => t.type !== "stairs")
                            ? "bg-[#ecfdf5] text-[#065f46]"
                            : "bg-[#fffbeb] text-[#92400e]"
                        }`}
                      >
                        {accessibleOnly || activeRoute.transitions.every((t) => t.type !== "stairs")
                          ? "♿ Step-Free"
                          : "🪜 Stairs"}
                      </span>
                    </div>
                    <p className="mt-1 text-lg font-bold text-[#2f3137]">
                      {Math.round(activeRoute.totalDistanceMeters)} m{" "}
                      <span className="text-xs font-normal text-[#747780]">
                        (~{Math.ceil(activeRoute.estimatedSeconds / 60)} min walk)
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-[#747780]">{activeRoute.summary}</p>
                  </div>

                  {/* Step carousel / pager navigation bar */}
                  <div className="flex items-center justify-between rounded-2xl border border-[#e5dfeb] bg-white p-2.5 shadow-xs">
                    <button
                      type="button"
                      onClick={goToPrevStep}
                      disabled={activeLegIndex === 0}
                      aria-label="Previous step"
                      className="flex items-center gap-1.5 rounded-xl bg-[#f1edf4] px-3 py-1.5 text-xs font-semibold text-[#5b238a] transition hover:bg-[#e8dfee] disabled:pointer-events-none disabled:opacity-30"
                    >
                      <span>←</span> Prev
                    </button>
                    <div className="text-center">
                      <p className="text-xs font-bold text-[#2f3137]">
                        Step {(activeLegIndex ?? 0) + 1} of {activeRoute.legs.length}
                      </p>
                      <p className="text-[10px] font-medium text-[#747780]">
                        {BUILDINGS.find((b) => b.id === activeRoute.legs[activeLegIndex ?? 0]?.building)?.name ?? activeRoute.legs[activeLegIndex ?? 0]?.building} · Level {activeRoute.legs[activeLegIndex ?? 0]?.level === 0 ? "Concourse" : activeRoute.legs[activeLegIndex ?? 0]?.level}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={goToNextStep}
                      disabled={activeLegIndex === activeRoute.legs.length - 1}
                      aria-label="Next step"
                      className="flex items-center gap-1.5 rounded-xl bg-[#5b238a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4b1d72] disabled:pointer-events-none disabled:opacity-30"
                    >
                      Next <span>→</span>
                    </button>
                  </div>

                  {/* Leg by leg guidance */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-xs font-semibold text-[#747780] uppercase tracking-wider">
                        Turn-by-turn ({activeRoute.legs.length} {activeRoute.legs.length === 1 ? "leg" : "legs"})
                      </h3>
                      <span className="text-[11px] text-[#92959d]">Click any step to view</span>
                    </div>

                    {activeRoute.legs.map((leg, index) => {
                      const isActive = activeLegIndex === index;
                      const transitionAfter = activeRoute.transitions[index];
                      const bName =
                        BUILDINGS.find((b) => b.id === leg.building)?.name ?? `${leg.building} Building`;
                      const instruction = getLegInstruction(
                        leg,
                        index,
                        activeRoute.legs.length,
                        activeRoute.fromRoom,
                        activeRoute.toRoom
                      );

                      return (
                        <div key={`leg-${index}`} className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => selectLeg(index)}
                            aria-current={isActive ? "step" : undefined}
                            className={`flex flex-col rounded-2xl border p-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-[#5b238a] ${
                              isActive
                                ? "border-[#5b238a] bg-[#faf8fc] ring-1 ring-[#5b238a] shadow-sm"
                                : "border-[#e5e7eb] bg-white hover:border-[#c8c9cf] hover:bg-[#fafafa]"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                                    isActive
                                      ? "bg-[#5b238a] text-white"
                                      : "bg-[#f1edf4] text-[#5b238a]"
                                  }`}
                                >
                                  {index + 1}
                                </span>
                                <p className="text-xs font-semibold text-[#5b238a]">
                                  {bName} · {leg.level === 0 ? "Concourse" : `Level ${leg.level}`}
                                </p>
                              </div>
                              <span className="text-xs font-medium text-[#747780]">
                                {Math.round(leg.distanceMeters)} m
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-[#2f3137]">
                              {instruction}
                            </p>
                            {isActive ? (
                              <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-[#5b238a]/10 px-2 py-0.5 text-[10px] font-bold text-[#5b238a]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#5b238a] animate-pulse" />
                                Active leg on map
                              </span>
                            ) : null}
                          </button>

                          {/* Transition cue to next leg */}
                          {transitionAfter ? (
                            <div
                              onClick={() => selectLeg(index + 1)}
                              role="button"
                              tabIndex={0}
                              className="my-1.5 flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-[#d8d3e2] bg-[#fcfbfe] px-3 py-2 text-xs transition hover:bg-[#f5f0fa]"
                            >
                              <span className="text-base leading-none">
                                {transitionAfter.type === "bridge"
                                  ? "🌁"
                                  : transitionAfter.type === "elevator"
                                  ? "🛗"
                                  : transitionAfter.type === "stairs"
                                  ? "🪜"
                                  : "🚪"}
                              </span>
                              <div className="flex-1">
                                <p className="font-semibold text-[#4b1d72]">{transitionAfter.description}</p>
                                <p className="text-[10px] text-[#747780]">
                                  {transitionAfter.type === "bridge"
                                    ? "Level 3 Skybridge walkway"
                                    : transitionAfter.type === "elevator"
                                    ? "Elevator vertical transit"
                                    : "Stairway vertical transit"}
                                </p>
                              </div>
                              <span className="text-[10px] font-semibold text-[#5b238a]">View next →</span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
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
