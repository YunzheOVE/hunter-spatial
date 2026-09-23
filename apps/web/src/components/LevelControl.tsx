"use client";

import { useState } from "react";

export function LevelControl({ levels, floor, onSelect }: {
  levels: readonly number[];
  floor: number | null;
  onSelect: (level: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const index = levels.indexOf(floor ?? 1);
  const start = Math.max(0, Math.min(index - 1, levels.length - 4));
  const visibleLevels = (expanded ? [...levels] : levels.slice(start, start + 4)).reverse();
  const buttonStyle = "flex h-10 min-w-10 items-center justify-center rounded-lg text-sm font-medium transition";

  return (
    <nav aria-label="Campus levels" className="absolute top-3 right-3 z-30 rounded-2xl border border-white/70 bg-white/75 p-1.5 shadow-[0_8px_30px_rgba(39,38,44,0.14)] backdrop-blur-[3px] md:top-5 md:right-5">
      <button type="button" aria-label="Go up one level" title="Go up one level" disabled={floor != null && index === levels.length - 1} onClick={() => onSelect(floor == null ? 1 : levels[index + 1])} className={`${buttonStyle} w-full text-[#555861] hover:bg-white/80 disabled:opacity-30`}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 15 6-6 6 6" /></svg>
      </button>
      <div id="campus-level-options" className={expanded ? "grid max-h-[calc(100dvh-15rem)] grid-cols-3 gap-1 overflow-y-auto p-1" : "flex flex-col gap-1 p-1"}>
        {visibleLevels.map((level) => (
          <button key={level} type="button" aria-label={level === 0 ? "Concourse" : `Level ${level}`} aria-pressed={floor === level} onClick={() => onSelect(level)} className={`${buttonStyle} ${floor === level ? "bg-[#5b238a] text-white shadow-sm" : "text-[#555861] hover:bg-white/80"}`}>
            {level === 0 ? "C" : level}
          </button>
        ))}
      </div>
      <button type="button" aria-label="Go down one level" title="Go down one level" disabled={floor != null && index <= 0} onClick={() => onSelect(floor == null ? levels[0] : levels[index - 1])} className={`${buttonStyle} w-full text-[#555861] hover:bg-white/80 disabled:opacity-30`}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <button type="button" aria-expanded={expanded} aria-controls="campus-level-options" aria-label={expanded ? "Collapse campus levels" : "Show all campus levels"} onClick={() => setExpanded(!expanded)} className="mt-1 min-h-9 w-full rounded-lg border-t border-[#5b238a]/10 px-1 text-xs font-semibold text-[#5b238a] hover:bg-white/80">
        {expanded ? "Less" : "All"}
      </button>
    </nav>
  );
}
