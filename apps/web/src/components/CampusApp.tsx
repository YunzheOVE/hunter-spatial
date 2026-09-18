"use client";

import { useMemo, useState } from "react";
import { parseRoomId } from "@/lib/parseRoomId";

const BUILDINGS = [
  { id: "N", name: "North Building", floorCount: 16 },
  { id: "E", name: "East Building", floorCount: 18 },
  { id: "W", name: "West Building", floorCount: 17 },
  { id: "TH", name: "Thomas Hunter Hall", floorCount: 7 },
  { id: "BTB", name: "Baker Theatre Building", floorCount: 6 },
] as const;

export function CampusApp() {
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [query, setQuery] = useState("N304");
  const [selectedRoom, setSelectedRoom] = useState<string | null>("N304");
  const [error, setError] = useState<string | null>(null);

  const building = BUILDINGS.find((item) => item.id === buildingId) ?? null;

  const floors = useMemo(() => {
    if (!building) return [];
    return Array.from({ length: building.floorCount }, (_, i) => i + 1);
  }, [building]);

  function selectBuilding(id: string) {
    setBuildingId(id);
    setFloor(null);
    setError(null);
  }

  function selectFloor(level: number) {
    setFloor(level);
  }

  function goToQuery() {
    try {
      const parsed = parseRoomId(query);
      setError(null);
      setBuildingId(parsed.buildingId);
      setFloor(parsed.floor || 1);
      setSelectedRoom(parsed.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse room");
    }
  }

  return (
    <div className="flex h-screen min-h-0">
      <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-[#1b1f2a] p-5">
        <div>
          <p className="text-xs tracking-[0.2em] text-[#e2b857] uppercase">CUNY Hunter College</p>
          <h1 className="mt-1 text-2xl">Hunter Spatial</h1>
          <p className="mt-2 text-sm text-[#b7b1a6]">
            Pick a building, then a floor. The indoor map loads after Milestone 1 GeoJSON is in place.
          </p>
        </div>

        <label className="flex flex-col gap-2 text-sm">
          Room
          <span className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && goToQuery()}
              className="w-full rounded border border-white/15 bg-[#12141a] px-3 py-2 font-sans text-[#f4efe6]"
              placeholder="N304"
            />
            <button
              type="button"
              onClick={goToQuery}
              className="rounded bg-[#5b2d82] px-3 py-2 font-sans text-sm"
            >
              Go
            </button>
          </span>
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        <div>
          <p className="mb-2 text-sm text-[#b7b1a6]">Buildings</p>
          <div className="flex flex-col gap-1">
            {BUILDINGS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectBuilding(item.id)}
                className={`rounded px-3 py-2 text-left font-sans text-sm ${
                  buildingId === item.id ? "bg-[#5b2d82]" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                <span className="font-semibold">{item.id}</span> {item.name}
              </button>
            ))}
          </div>
        </div>

        {building ? (
          <div>
            <p className="mb-2 text-sm text-[#b7b1a6]">{building.name} floors</p>
            <div className="grid grid-cols-4 gap-1">
              {floors.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => selectFloor(level)}
                  className={`rounded px-2 py-1 font-sans text-sm ${
                    floor === level ? "bg-[#e2b857] text-[#12141a]" : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedRoom ? (
          <p className="text-sm">
            Selected: <span className="text-[#e2b857]">{selectedRoom}</span>
            {buildingId && floor ? ` — ${buildingId}${floor}` : ""}
          </p>
        ) : null}
      </aside>
      <main className="flex min-w-0 flex-1 items-center justify-center p-8 text-center text-[#b7b1a6]">
        <p>
          MapLibre floor plan goes here.
          <br />
          Extract Hunter geometry (Milestone 1) to render rooms.
        </p>
      </main>
    </div>
  );
}
