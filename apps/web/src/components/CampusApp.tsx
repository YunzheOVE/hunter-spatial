"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  campusLevelsForSelection,
  type CampusBuildingId,
  closestCampusLevel,
} from "@/lib/campusLevels";
import { canonicalRoomId, parseRoomId } from "@/lib/parseRoomId";

const MapView = dynamic(() => import("./MapView").then((module) => module.MapView), { ssr: false });

const BUILDINGS = [
  { id: "N", name: "North Building" },
  { id: "E", name: "East Building" },
  { id: "W", name: "West Building" },
  { id: "TH", name: "Thomas Hunter Hall" },
  { id: "BTB", name: "Baker Theatre" },
] as const;

export function CampusApp() {
  const [buildingId, setBuildingId] = useState<CampusBuildingId | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const buildingName = BUILDINGS.find((building) => building.id === buildingId)?.name;
  const levelName = floor === 0 ? "Concourse" : `Level ${floor}`;
  const mapStatus = floor == null ? "Outdoor" : `${buildingName ?? "All buildings"} · ${levelName}`;
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

  return (
    <div className="relative h-dvh min-h-0 overflow-hidden bg-[#f4f3ef] text-[#41434a]">
      <main className="absolute inset-0">
        <MapView
          buildingId={buildingId}
          floor={floor}
          panelOpen={panelOpen}
          selectedRoom={selectedRoom}
          onSelectRoom={(roomId) => {
            setSelectedRoom(roomId);
            setQuery(roomId);
            setError(null);
          }}
        />
        <div className="pointer-events-none absolute top-4 right-4 z-10 max-w-[calc(100%-2rem)] rounded-2xl bg-white/95 px-4 py-3 text-sm font-medium shadow-[0_8px_30px_rgba(39,38,44,0.14)] backdrop-blur md:top-5 md:right-5">
          {mapStatus}
        </div>
      </main>

      {panelOpen ? (
        <aside
          id="map-controls"
          className="absolute top-3 right-3 left-3 z-20 flex max-h-[58dvh] flex-col overflow-y-auto rounded-[26px] border border-black/5 bg-white/95 p-5 shadow-[0_18px_55px_rgba(39,38,44,0.17)] backdrop-blur md:top-5 md:right-auto md:left-5 md:max-h-[calc(100dvh-2.5rem)] md:w-[350px]"
        >
          <header className="relative">
            <div className="pr-16">
              <p className="text-sm font-semibold text-[#5b238a]">Hunter College</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-[#2f3137]">Campus map</h1>
              <p className="mt-2 text-sm leading-5 text-[#747780]">
                Find a room or choose a campus level.
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

        <label className="mt-5 block text-sm font-medium text-[#4c4f56]" htmlFor="room-search">
          Room
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="room-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && goToQuery()}
            className="min-w-0 flex-1 rounded-xl border border-[#dedfe3] bg-[#f5f6f8] px-3.5 py-2.5 text-sm text-[#2f3137] outline-none transition placeholder:text-[#92959d] focus:border-[#5b238a] focus:ring-2 focus:ring-[#5b238a]/15"
            placeholder="N11007"
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

        {selectedRoom ? (
          <p className="mt-5 border-t border-[#ebecef] pt-4 text-sm text-[#747780]">
            Selected room <span className="font-semibold text-[#2f3137]">{selectedRoom}</span>
          </p>
        ) : null}
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-controls="map-controls"
          aria-expanded={false}
          className="absolute top-4 left-4 z-20 rounded-full bg-[#5b238a] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(39,38,44,0.2)] transition hover:bg-[#4b1d72] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:top-5 md:left-5"
        >
          Map controls
        </button>
      )}
    </div>
  );
}
