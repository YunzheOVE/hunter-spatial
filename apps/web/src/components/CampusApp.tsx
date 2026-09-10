"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { findRoom, getFloorView, listBuildings, roomsOnFloor, type Room } from "@/lib/campus";
import { parseRoomId } from "@/lib/parseRoomId";

export function CampusApp() {
  const buildings = listBuildings();
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [query, setQuery] = useState("N304");
  const [selectedRoom, setSelectedRoom] = useState<Room | undefined>(() => findRoom("N304"));
  const [error, setError] = useState<string | null>(null);
  const [CanvasView, setCanvasView] = useState<ComponentType<{
    buildingId: string | null;
    floor: number | null;
    selectedRoom?: Room;
  }> | null>(null);

  useEffect(() => {
    void import("./CampusCanvas").then((mod) => {
      setCanvasView(() => mod.CampusCanvas);
    });
  }, []);

  const building = buildings.find((item) => item.id === buildingId) ?? null;
  const floorView = buildingId && floor ? getFloorView(buildingId, floor) : null;
  const floorRooms = buildingId && floor ? roomsOnFloor(buildingId, floor) : [];

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
    const first = roomsOnFloor(buildingId ?? "", level)[0];
    if (first) setSelectedRoom(first);
  }

  function goToQuery() {
    try {
      const parsed = parseRoomId(query);
      const room = findRoom(parsed.id);
      if (!room) {
        setError(`No marker for ${parsed.id} in the beta catalog.`);
        setBuildingId(parsed.buildingId);
        setFloor(parsed.floor || 1);
        setSelectedRoom(undefined);
        return;
      }
      setError(null);
      setBuildingId(room.buildingId);
      setFloor(room.floor);
      setSelectedRoom(room);
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
            Pick a building, then a floor. Scanned hallways load only after you open them.
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
            {buildings.map((item) => (
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
              {floors.map((level) => {
                const scanned = building.floors.some((entry) => entry.level === level && entry.scan);
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => selectFloor(level)}
                    className={`rounded px-2 py-1 font-sans text-sm ${
                      floor === level ? "bg-[#e2b857] text-[#12141a]" : "bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {level}
                    {scanned ? "*" : ""}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[#b7b1a6]">* has a hallway scan</p>
          </div>
        ) : null}

        {floorView ? (
          <p className="text-sm text-[#b7b1a6]">
            {floorView.kind === "scan"
              ? `Showing Polycam hallway for ${buildingId}${floor}.`
              : `No scan yet — floor plan for ${buildingId}${floor}.`}
          </p>
        ) : null}

        {selectedRoom ? (
          <p className="text-sm">
            Marker: <span className="text-[#e2b857]">{selectedRoom.id}</span> — {selectedRoom.label}
          </p>
        ) : null}

        {floorRooms.length > 1 ? (
          <div className="flex flex-col gap-1">
            {floorRooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedRoom(room)}
                className={`rounded px-3 py-1 text-left font-sans text-sm ${
                  selectedRoom?.id === room.id ? "bg-white/15" : "bg-white/5"
                }`}
              >
                {room.id}
              </button>
            ))}
          </div>
        ) : null}
      </aside>
      <main className="min-w-0 flex-1">
        {CanvasView ? (
          <CanvasView buildingId={buildingId} floor={floor} selectedRoom={selectedRoom} />
        ) : (
          <div className="flex h-full items-center justify-center text-[#b7b1a6]">Loading campus…</div>
        )}
      </main>
    </div>
  );
}
