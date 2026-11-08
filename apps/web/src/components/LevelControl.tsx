"use client";

import { useState } from "react";
import type { CampusBuildingId } from "@/lib/campusLevels";

const BUILDING_OPTIONS: { id: CampusBuildingId | null; short: string; name: string }[] = [
  { id: null, short: "ALL", name: "All buildings" },
  { id: "N", short: "NORTH", name: "North Building" },
  { id: "E", short: "EAST", name: "East Building" },
  { id: "W", short: "WEST", name: "West Building" },
  { id: "TH", short: "THH", name: "Thomas Hunter Hall" },
  { id: "BTB", short: "BAKER", name: "Baker Theatre" },
];

export function LevelControl({ levels, floor, onSelect, buildingId = null, onSelectBuilding, onOutdoor, routeLevels = [], className = "" }: {
  levels: readonly number[];
  floor: number | null;
  onSelect: (level: number) => void;
  buildingId?: CampusBuildingId | null;
  onSelectBuilding?: (id: CampusBuildingId | null) => void;
  onOutdoor?: () => void;
  routeLevels?: readonly number[];
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [buildingMenu, setBuildingMenu] = useState(false);
  const index = levels.indexOf(floor ?? 1);
  const start = Math.max(0, Math.min(index - 1, levels.length - 4));
  const visibleLevels = (expanded ? [...levels] : levels.slice(start, start + 4)).reverse();
  const buttonStyle = "relative flex h-11 min-w-11 items-center justify-center rounded-[10px] text-[15px] font-semibold transition";
  const building = BUILDING_OPTIONS.find((option) => option.id === buildingId) ?? BUILDING_OPTIONS[0];

  return (
    <nav aria-label="Campus levels" className={`absolute right-3 z-30 rounded-[14px] border border-white/60 bg-white/75 p-1.5 shadow-[0_1px_3px_rgba(60,64,67,.25),0_4px_12px_rgba(60,64,67,.12)] backdrop-blur-md backdrop-saturate-150 md:right-4 ${className}`}>
      {onSelectBuilding ? (
        <div className="relative">
          <button type="button" aria-haspopup="true" aria-expanded={buildingMenu} aria-label={`Choose building: ${building.name}`} onClick={() => setBuildingMenu(!buildingMenu)} className="flex h-8 w-full items-center justify-center rounded-lg text-[10px] font-bold tracking-wider text-[#5b238a] hover:bg-black/5">
            {building.short}
          </button>
          {buildingMenu ? (
            <ul className="absolute top-0 right-full mr-2 w-48 rounded-xl border border-white/60 bg-white/85 py-1 shadow-[0_1px_3px_rgba(60,64,67,.25),0_4px_12px_rgba(60,64,67,.12)] backdrop-blur-md">
              {BUILDING_OPTIONS.map((option) => (
                <li key={option.short}>
                  <button type="button" aria-pressed={option.id === buildingId} onClick={() => { onSelectBuilding(option.id); setBuildingMenu(false); }} className={`flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-[#5b238a]/10 ${option.id === buildingId ? "font-semibold text-[#5b238a]" : "text-[#1f1f1f]"}`}>
                    {option.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <span className="mx-auto my-1 block h-px w-8 bg-[#e8eaed]" />
        </div>
      ) : null}
      <button type="button" aria-label="Go up one level" title="Go up one level" disabled={floor != null && index === levels.length - 1} onClick={() => onSelect(floor == null ? 1 : levels[index + 1])} className={`${buttonStyle} h-8 w-full text-[#5f6368] hover:bg-black/5 disabled:opacity-30`}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 15 6-6 6 6" /></svg>
      </button>
      <div id="campus-level-options" className={expanded ? "grid max-h-[calc(100dvh-18rem)] grid-cols-3 gap-0.5 overflow-y-auto" : "flex flex-col gap-0.5"}>
        {visibleLevels.map((level) => (
          <button key={level} type="button" aria-label={`${level === 0 ? "Concourse" : `Level ${level}`}${routeLevels.includes(level) ? ", on route" : ""}`} aria-pressed={floor === level} onClick={() => onSelect(level)} className={`${buttonStyle} ${floor === level ? "bg-[#5b238a] text-white" : "text-[#3c4043] hover:bg-black/5"}`}>
            {level === 0 ? "C" : level}
            {routeLevels.includes(level) ? <span aria-hidden="true" className={`absolute top-1.5 right-1 h-[7px] w-[7px] rounded-full ${floor === level ? "bg-white" : "bg-[#6b2fa3]"}`} /> : null}
          </button>
        ))}
      </div>
      <button type="button" aria-label="Go down one level" title="Go down one level" disabled={floor != null && index <= 0} onClick={() => onSelect(floor == null ? levels[0] : levels[index - 1])} className={`${buttonStyle} h-8 w-full text-[#5f6368] hover:bg-black/5 disabled:opacity-30`}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <button type="button" aria-expanded={expanded} aria-controls="campus-level-options" aria-label={expanded ? "Collapse campus levels" : "Show all campus levels"} onClick={() => setExpanded(!expanded)} className="hidden min-h-8 w-full rounded-lg text-xs font-semibold text-[#5b238a] hover:bg-black/5 md:block">
        {expanded ? "Less" : "All"}
      </button>
      {onOutdoor ? (
        <>
          <span className="mx-auto my-1 block h-px w-8 bg-[#e8eaed]" />
          <button type="button" aria-label="Outdoor campus" aria-pressed={floor == null} title="Outdoor view" onClick={onOutdoor} className={`${buttonStyle} w-full ${floor == null ? "bg-[#5b238a] text-white" : "text-[#3c4043] hover:bg-black/5"}`}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l5-3v16M10 21V3l9 4v14M14 9h2M14 13h2M14 17h2" /></svg>
          </button>
        </>
      ) : null}
    </nav>
  );
}
