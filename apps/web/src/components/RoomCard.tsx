"use client";

import { useRef } from "react";
import type { RoomMedia } from "@/lib/roomMedia";

export function RoomCard({ id, name, building, level, media, onDirections, onFrom, onClose }: {
  id: string;
  name: string;
  building: string;
  level: number;
  media?: RoomMedia;
  onDirections: () => void;
  onFrom: () => void;
  onClose: () => void;
}) {
  const photoDialog = useRef<HTMLDialogElement>(null);
  const preview = media?.panorama?.preview ?? media?.photo?.src;
  const thumbnail = preview ? (
    <span className="relative block">
      {/* Campus assets have no fixed dimensions; crop only the preview. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={media?.panorama ? `360° preview of ${name || id}` : media?.photo?.alt} className="h-36 w-full rounded-xl object-cover sm:h-40" />
      {media?.panorama ? <span className="absolute right-2 bottom-2 rounded-full bg-[#5b238a] px-2 py-1 text-xs font-semibold text-white">360°</span> : null}
    </span>
  ) : null;

  return (
    <section aria-label={`Room ${id}`} className="absolute bottom-14 left-3 right-20 z-20 max-h-[40dvh] overflow-y-auto rounded-2xl border border-white/70 bg-white/80 p-3 shadow-[0_12px_40px_rgba(39,38,44,0.18)] backdrop-blur-[3px] md:bottom-6 md:left-5 md:right-auto md:w-[400px]">
      <button type="button" onClick={onClose} aria-label="Close room details" className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-[#555861] hover:bg-white">×</button>
      <div className={preview ? "grid grid-cols-[minmax(80px,0.85fr)_minmax(0,1.15fr)] items-start gap-3" : ""}>
      {media?.panorama ? (
        <a href={media.panorama.viewerUrl} target="_blank" rel="noreferrer" aria-label={`View ${name || id} in 360° (opens in a new tab)`}>{thumbnail}</a>
      ) : media?.photo ? (
        <button type="button" className="block w-full" onClick={() => photoDialog.current?.showModal()} aria-label={`Enlarge photo of ${name || id}`}>{thumbnail}</button>
      ) : null}
      <div className="min-w-0">
      <div className="pr-6">
        <h2 className="text-base font-bold text-[#2f3137]">{name && name !== id ? name : id}</h2>
        {name && name !== id ? <p className="text-xs font-medium">{id}</p> : null}
        <p className="mt-1 text-xs text-[#555861]">{building} · {level === 0 ? "Concourse" : `Level ${level}`}</p>
      </div>
      <button type="button" onClick={onDirections} className="mt-3 w-full rounded-xl bg-[#5b238a] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4b1d72]">Directions</button>
      {media?.panorama ? <a className="mt-2 block rounded-xl border border-[#5b238a]/40 px-3 py-2 text-center text-sm font-semibold text-[#5b238a]" href={media.panorama.viewerUrl} target="_blank" rel="noreferrer">View in 360° <span className="sr-only">(opens in a new tab)</span></a> : null}
      {media?.nearbyHallway ? <a className="mt-2 block text-sm font-medium text-[#5b238a] underline" href={media.nearbyHallway.viewerUrl} target="_blank" rel="noreferrer">View nearby hallway · {media.nearbyHallway.name}<span className="sr-only"> (opens in a new tab)</span></a> : null}
      <button type="button" onClick={onFrom} className="mt-2 text-xs font-medium text-[#5b238a] underline underline-offset-2">Use as starting point</button>
      </div>
      </div>
      {media?.photo ? (
        <dialog ref={photoDialog} className="photo-dialog m-auto max-h-[90dvh] w-[min(900px,92vw)] rounded-2xl bg-white p-4" aria-label={`Photo of ${name || id}`} onClick={(event) => { if (event.target === event.currentTarget) photoDialog.current?.close(); }}>
          <form method="dialog" className="mb-3 flex items-center justify-between gap-4"><p className="font-semibold">{name || id} · {building}</p><button className="rounded-lg bg-[#f1edf4] px-3 py-2 text-sm text-[#5b238a]">Back to map</button></form>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.photo.src} alt={media.photo.alt} className="max-h-[72dvh] w-full object-contain" />
        </dialog>
      ) : null}
    </section>
  );
}
