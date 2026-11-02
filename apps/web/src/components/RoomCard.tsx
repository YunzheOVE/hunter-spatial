"use client";

import { useRef } from "react";
import type { RoomMedia } from "@/lib/roomMedia";
import { Glyph } from "./WayfindingIcon";

const actionClass = "flex w-20 flex-col items-center gap-1.5 text-xs font-medium text-[#5b238a]";
const circleBase = "flex h-12 w-12 items-center justify-center rounded-full border";
const circleClass = `${circleBase} border-[#d3c3e3] bg-white/70`;

export function RoomCard({ id, name, building, level, media, onDirections, onFrom, onClose, onPanorama, onUpload }: {
  id: string;
  name: string;
  building: string;
  level: number;
  media?: RoomMedia;
  onDirections: () => void;
  onFrom: () => void;
  onClose: () => void;
  onPanorama?: () => void;
  onUpload?: () => void;
}) {
  const photoDialog = useRef<HTMLDialogElement>(null);
  const preview = media?.panorama?.preview ?? media?.photo?.src;
  const title = name && name !== id ? name : id;
  const thumbnail = preview ? (
    <span className="relative block">
      {/* Campus assets have no fixed dimensions; crop only the preview. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={media?.panorama ? `360° preview of ${name || id}` : media?.photo?.alt} className="h-44 w-full object-cover" />
      {media?.panorama ? <span className="absolute bottom-3 left-3 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#1f1f1f] shadow">360°</span> : null}
    </span>
  ) : null;
  const panoramaIcon = <Glyph><ellipse cx="12" cy="12" rx="9" ry="4" /><path d="M12 3a4 9 0 0 1 0 18" /></Glyph>;

  return (
    <section aria-label={`Room ${id}`} className="text-[#1f1f1f]">
      {media?.panorama ? (
        <a href={media.panorama.viewerUrl} target="_blank" rel="noreferrer" aria-label={`View ${name || id} in 360° (opens in a new tab)`}>{thumbnail}</a>
      ) : media?.photo ? (
        <button type="button" className="block w-full" onClick={() => photoDialog.current?.showModal()} aria-label={`Enlarge photo of ${name || id}`}>{thumbnail}</button>
      ) : null}
      <div className="flex items-start gap-3 px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="mt-1 text-sm text-[#5f6368]">{title !== id ? `${id} · ` : ""}{building} · {level === 0 ? "Concourse" : `Level ${level}`}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close room details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/5 text-[#5f6368] hover:bg-black/10">
          <Glyph><path d="M6 6l12 12M18 6 6 18" /></Glyph>
        </button>
      </div>
      <div className="flex justify-between px-5 pb-5">
        <button type="button" onClick={onDirections} className={actionClass}>
          <span className={`${circleBase} border-[#5b238a] bg-[#5b238a] text-white`}><Glyph><path d="M12 2 2 12l10 10 10-10z" /><path d="M9 14v-2a2 2 0 0 1 2-2h4" /><path d="m13 8 2 2-2 2" /></Glyph></span>
          Directions
        </button>
        <button type="button" onClick={onFrom} className={actionClass}>
          <span className={circleClass}><Glyph><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" /></Glyph></span>
          Start here
        </button>
        {onPanorama ? (
          <button type="button" onClick={onPanorama} className={actionClass}><span className={circleClass}>{panoramaIcon}</span>View in 360°</button>
        ) : media?.panorama ? (
          <a href={media.panorama.viewerUrl} target="_blank" rel="noreferrer" className={actionClass}><span className={circleClass}>{panoramaIcon}</span>View in 360°<span className="sr-only"> (opens in a new tab)</span></a>
        ) : null}
        {onUpload ? (
          <button type="button" onClick={onUpload} className={actionClass}>
            <span className={circleClass}><Glyph><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Glyph></span>
            Add 360°
          </button>
        ) : null}
      </div>
      {media?.nearbyHallway ? (
        <div className="flex min-h-12 items-center gap-4 border-t border-[#e8eaed] px-6 py-3 text-sm">
          <span className="text-[#5b238a]"><Glyph><path d="M4 20h4v-4h4v-4h4V8h4" /></Glyph></span>
          <a className="font-medium text-[#5b238a] underline-offset-2 hover:underline" href={media.nearbyHallway.viewerUrl} target="_blank" rel="noreferrer">View nearby hallway · {media.nearbyHallway.name}<span className="sr-only"> (opens in a new tab)</span></a>
        </div>
      ) : null}
      {media?.photo ? (
        <dialog ref={photoDialog} className="photo-dialog m-auto max-h-[90dvh] w-[min(900px,92vw)] rounded-2xl bg-white p-4" aria-label={`Photo of ${name || id}`} onClick={(event) => { if (event.target === event.currentTarget) photoDialog.current?.close(); }}>
          <form method="dialog" className="mb-3 flex items-center justify-between gap-4"><p className="font-semibold">{name || id} · {building}</p><button className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-[#5b238a]">Back to map</button></form>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.photo.src} alt={media.photo.alt} className="max-h-[72dvh] w-full object-contain" />
        </dialog>
      ) : null}
    </section>
  );
}
