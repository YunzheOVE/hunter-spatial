"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { canonicalRoomId, parseRoomId } from "@/lib/parseRoomId";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), { ssr: false });

const BUILDINGS = [
  { id: "N", name: "North Building", floorCount: 16 },
  { id: "E", name: "East Building", floorCount: 18 },
  { id: "W", name: "West Building", floorCount: 17 },
  { id: "TH", name: "Thomas Hunter Hall", floorCount: 7 },
  { id: "BTB", name: "Baker Theatre Building", floorCount: 6 },
] as const;

const CAMPUS_FLOORS = [0, ...Array.from({ length: 18 }, (_, i) => i + 1)];

export function CampusApp() {
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectBuilding(id: string) {
    setBuildingId(id);
    setError(null);
  }

  function selectFloor(level: number) {
    setFloor(level);
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
      setError(err instanceof Error ? err.message : "Could not parse room");
    }
  }

  return (
    <div className="flex h-dvh min-h-0">
      <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-[#1b1f2a] p-5">
        <div>
          <p className="text-xs tracking-[0.2em] text-[#e2b857] uppercase">CUNY Hunter College</p>
          <h1 className="mt-1 text-2xl">Hunter Spatial</h1>
          <p className="mt-2 text-sm text-[#b7b1a6]">
            Outdoor is the 3D campus. Each numbered floor sits at its real height, with rooms on that layer and the building mass below.
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
            <button
              type="button"
              onClick={() => setBuildingId(null)}
              className={`rounded px-3 py-2 text-left font-sans text-sm ${
                buildingId == null ? "bg-[#5b2d82]" : "bg-white/5 hover:bg-white/10"
              }`}
            >
              Whole campus
            </button>
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

        <div>
          <p className="mb-2 text-sm text-[#b7b1a6]">Floor</p>
          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              onClick={() => setFloor(null)}
              className={`col-span-4 rounded px-2 py-1 font-sans text-sm ${
                floor == null ? "bg-[#e2b857] text-[#12141a]" : "bg-white/5 hover:bg-white/10"
              }`}
            >
              Outdoor
            </button>
            {CAMPUS_FLOORS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => selectFloor(level)}
                className={`rounded px-2 py-1 font-sans text-sm ${
                  floor === level ? "bg-[#e2b857] text-[#12141a]" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                {level === 0 ? "C" : level}
              </button>
            ))}
          </div>
        </div>

        {selectedRoom ? (
          <p className="text-sm">
            Selected: <span className="text-[#e2b857]">{selectedRoom}</span>
            {buildingId && floor != null ? ` — ${buildingId}${floor === 0 ? "C" : floor}` : ""}
          </p>
        ) : null}
      </aside>
      <main className="relative h-full min-h-0 min-w-0 flex-1">
        <MapView
          buildingId={buildingId}
          floor={floor}
          selectedRoom={selectedRoom}
          onSelectRoom={(roomId) => {
            setSelectedRoom(roomId);
            setQuery(roomId);
            setError(null);
          }}
        />
      </main>
    </div>
  );
}
