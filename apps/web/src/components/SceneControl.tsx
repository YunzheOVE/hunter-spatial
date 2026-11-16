"use client";

import { useState, type ReactNode } from "react";
import type { Season, TimeOfDay, Weather } from "@/lib/mapScene";
import { Glyph } from "./WayfindingIcon";

const TIMES: { id: TimeOfDay; label: string; icon: ReactNode }[] = [
  { id: "day", label: "Day", icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></> },
  { id: "golden", label: "Golden hour", icon: <path d="M12 10V2M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0" /> },
  { id: "night", label: "Night", icon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /> },
];

const WEATHERS: { id: Weather; label: string; icon: ReactNode }[] = [
  { id: "clear", label: "Clear", icon: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /> },
  { id: "rain", label: "Rain", icon: <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24M16 14v6M8 14v6M12 16v6" /> },
  { id: "snow", label: "Snow", icon: <path d="M2 12h20M12 2v20m8-4-4-4 4-4M4 8l4 4-4 4m12-12-4 4-4-4m0 16 4-4 4 4" /> },
];

const SEASONS: { id: Season; label: string; icon: ReactNode }[] = [
  { id: "spring", label: "Spring", icon: <path d="M7 20h10M10 20c5.5-2.5.8-6.4 3-10M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8zM14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /> },
  { id: "summer", label: "Summer", icon: <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19ZM12 19v3" /> },
  { id: "autumn", label: "Autumn", icon: <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10ZM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /> },
  { id: "winter", label: "Winter", icon: <path d="M12 22V8M12 13l-4-4M12 11l4-4M8 9V5M16 7V4M12 8V3" /> },
];

function Group<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string; icon: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5">
      {options.map((option) => (
        <button key={option.id} type="button" title={option.label} aria-label={option.label} aria-pressed={value === option.id} onClick={() => onChange(option.id)} className={`flex h-8 w-8 items-center md:h-9 md:w-9 justify-center rounded-full transition ${value === option.id ? "bg-[#5b238a] text-white" : "text-[#3c4043] hover:bg-black/5"}`}>
          <Glyph size={18}>{option.icon}</Glyph>
        </button>
      ))}
    </div>
  );
}

/** Time of day and weather for the outdoor view; indoors only day and night apply, so it is a single toggle. */
export function SceneControl({ time, weather, season, onTime, onWeather, onSeason, dayNightOnly = false, className = "" }: { time: TimeOfDay; weather: Weather; season: Season; onTime: (time: TimeOfDay) => void; onWeather: (weather: Weather) => void; onSeason: (season: Season) => void; dayNightOnly?: boolean; className?: string }) {
  const current = SEASONS.find((option) => option.id === season) ?? SEASONS[0];
  const next = SEASONS[(SEASONS.indexOf(current) + 1) % SEASONS.length];
  const [open, setOpen] = useState(false);
  const timeIcon = (TIMES.find((option) => option.id === time) ?? TIMES[0]).icon;
  const pill = "flex items-center gap-1 rounded-full border border-white/60 bg-white/60 p-1 shadow-[0_1px_3px_rgba(60,64,67,.25),0_4px_12px_rgba(60,64,67,.12)] backdrop-blur-md backdrop-saturate-150";
  if (dayNightOnly) {
    const night = time === "night";
    return (
      <div className={`${pill} ${className}`}>
        <button type="button" aria-pressed={night} aria-label={night ? "Night mode on. Switch to day" : "Switch to night mode"} title={night ? "Switch to day" : "Switch to night"} onClick={() => onTime(night ? "day" : "night")} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5b238a] text-white md:h-9 md:w-9">
          <Glyph size={18}>{TIMES[night ? 2 : 0].icon}</Glyph>
        </button>
      </div>
    );
  }
  return (
    <div className={`${pill} ${className}`}>
      {/* Collapsed to one button by default so the pill doesn't cover the map. */}
      <button type="button" aria-expanded={open} aria-controls="scene-options" aria-label={open ? "Hide scene options" : "Show time, weather and season options"} onClick={() => setOpen(!open)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5b238a] text-white md:h-9 md:w-9">
        <Glyph size={18}>{open ? <path d="M18 6 6 18M6 6l12 12" /> : timeIcon}</Glyph>
      </button>
      <div id="scene-options" className={`items-center gap-1 ${open ? "flex" : "hidden"}`}>
        <Group label="Time of day" options={TIMES} value={time} onChange={onTime} />
        <span aria-hidden="true" className="h-6 w-px bg-black/10" />
        <Group label="Weather" options={WEATHERS} value={weather} onChange={onWeather} />
        <span aria-hidden="true" className="h-6 w-px bg-black/10" />
        {/* One button that cycles through the seasons keeps the pill narrow on phones. */}
        <button type="button" title={`Season: ${current.label}`} aria-label={`Season: ${current.label}. Switch to ${next.label}`} onClick={() => onSeason(next.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-[#3c4043] hover:bg-black/5 md:h-9 md:w-9">
          <Glyph size={18}>{current.icon}</Glyph>
        </button>
      </div>
    </div>
  );
}
