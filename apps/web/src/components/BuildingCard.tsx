"use client";

import { CAMPUS_ADDRESS } from "./RoomCard";
import { Glyph } from "./WayfindingIcon";

export type CampusEntrance = { id: string; name: string; building: string; accessible: boolean };
type Place = { id: string; name: string; level: number };

const rowClass = "flex min-h-12 w-full items-center gap-[18px] px-6 py-3 text-left text-sm";

/** Outdoor view: what you see after tapping one of Hunter's buildings. */
export function BuildingCard({ name, topFloor, entrances, places, onGoInside, onSelectPlace, onClose }: {
  name: string;
  topFloor: number;
  entrances: CampusEntrance[];
  places: Place[];
  onGoInside: () => void;
  onSelectPlace: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section aria-label={name} className="text-[#1f1f1f]">
      <div className="flex items-start gap-3 px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold tracking-[-0.01em]">{name}</h2>
          <p className="mt-1 text-sm text-[#5f6368]">Hunter College · {topFloor} floors</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close building details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/5 text-[#5f6368] hover:bg-black/10">
          <Glyph><path d="M6 6l12 12M18 6 6 18" /></Glyph>
        </button>
      </div>

      <div className="px-6 pb-5">
        <button type="button" onClick={onGoInside} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#5b238a] text-[15px] font-semibold text-white hover:bg-[#4a1c72]">
          <Glyph><path d="M3 21h18M5 21V8l5-3v16M10 21V3l9 4v14M14 9h2M14 13h2M14 17h2" /></Glyph>
          Go inside
        </button>
      </div>

      <div className="border-t border-[#e8eaed] py-2">
        <div className={rowClass}>
          <span className="text-[#5b238a]"><Glyph><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Glyph></span>
          <span>{CAMPUS_ADDRESS}</span>
        </div>
      </div>

      <div className="border-t border-[#e8eaed] pt-4 pb-2">
        <h3 className="px-6 pb-1 text-base font-semibold">Entrances</h3>
        {entrances.length ? entrances.map((entrance) => (
          <div key={entrance.id} className={rowClass}>
            <span className={entrance.accessible ? "text-[#1d4ed8]" : "text-[#0f766e]"}>
              {entrance.accessible
                ? <Glyph><circle cx="16" cy="4" r="1" /><path d="m18 19 1-7-6 1M5 8l3-3 5.5 3-2.36 3.5M4.24 14.5a5 5 0 0 0 6.88 6M13.76 17.5a5 5 0 0 0-6.88-6" /></Glyph>
                : <Glyph><path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M13 4.56v16.16L5 20V5.56l8-1z" /></Glyph>}
            </span>
            <span>{entrance.name}{entrance.accessible ? <span className="block text-[13px] text-[#5f6368]">Accessible entrance</span> : null}</span>
          </div>
        )) : <p className="px-6 py-3 text-sm text-[#5f6368]">Entrances for this building aren&apos;t mapped yet.</p>}
      </div>

      {places.length ? (
        <div className="border-t border-[#e8eaed] pt-4 pb-4">
          <h3 className="px-6 pb-1 text-base font-semibold">Places inside</h3>
          {places.map((place) => (
            <button key={place.id} type="button" onClick={() => onSelectPlace(place.id)} className={`${rowClass} hover:bg-[#5b238a]/10`}>
              <span className="text-[#5b238a]"><Glyph><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Glyph></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{place.name}</span>
                <span className="block text-[13px] text-[#5f6368]">{place.id} · {place.level === 0 ? "Concourse" : `Level ${place.level}`}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
