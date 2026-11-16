"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApprovedPanorama } from "@/lib/panorama";
import type { RoomMedia } from "@/lib/roomMedia";
import { Glyph } from "./WayfindingIcon";

const actionClass = "flex w-20 flex-col items-center gap-1 text-xs font-medium whitespace-nowrap text-[#5b238a]";
const circleBase = "flex h-10 w-10 items-center justify-center rounded-full border";
const circleClass = `${circleBase} border-[#d3c3e3] bg-white/50`;
const pillClass = "absolute bottom-3 left-3 flex h-8 items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-semibold text-[#1f1f1f] shadow-[0_1px_3px_rgba(0,0,0,.3)] hover:bg-white";
const tileClass = "h-16 w-24 shrink-0 overflow-hidden rounded-[10px]";
export const CAMPUS_ADDRESS = "695 Park Ave, New York, NY 10065";

const panoramaIcon = <Glyph><ellipse cx="12" cy="12" rx="9" ry="4" /><path d="M12 3a4 9 0 0 1 0 18" /></Glyph>;

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-4 px-5 py-2 text-[13px]">
      <span className="text-[#5b238a]">{icon}</span>
      {children}
    </div>
  );
}

/** The room's approved 360° photo, if one has been reviewed and published. */
function useApprovedPanorama(locationId: string) {
  const [panorama, setPanorama] = useState<ApprovedPanorama | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPanorama(null);
    fetch(`/api/panoramas?locationId=${encodeURIComponent(locationId)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<ApprovedPanorama | null>) : null))
      .then((data) => { if (!controller.signal.aborted) setPanorama(data); })
      // A missing photo is not an error worth showing: the card falls back to "Add a 360° photo".
      .catch(() => {});
    return () => controller.abort();
  }, [locationId]);
  return panorama;
}

export function RoomCard({ id, locationId, name, building, level, media, stepFree, onDirections, onFrom, onClose, onPanorama, onUpload }: {
  id: string;
  locationId: string;
  name: string;
  building: string;
  level: number;
  media?: RoomMedia;
  stepFree: boolean;
  onDirections: () => void;
  onFrom: () => void;
  onClose: () => void;
  onPanorama: () => void;
  onUpload?: () => void;
}) {
  const photoDialog = useRef<HTMLDialogElement>(null);
  const approved = useApprovedPanorama(locationId);
  const title = name && name !== id ? name : id;
  const levelLabel = level === 0 ? "Concourse" : `Level ${level}`;
  const hasPanorama = Boolean(approved || media?.panorama);
  const heroImage = approved?.imageUrl ?? media?.panorama?.preview ?? media?.photo?.src;
  // Approved uploads open in the in-app viewer; hosted tours open as a link in a new tab.
  const panoramaControl = (className: string, children: ReactNode, label?: string) =>
    !approved && media?.panorama ? (
      <a href={media.panorama.viewerUrl} target="_blank" rel="noreferrer" className={className} aria-label={label}>{children}<span className="sr-only"> (opens in a new tab)</span></a>
    ) : (
      <button type="button" onClick={onPanorama} className={className} aria-label={label}>{children}</button>
    );
  const photoControl = (className: string, children: ReactNode) =>
    hasPanorama ? panoramaControl(className, children, `View ${title} in 360°`) : (
      <button type="button" className={className} onClick={() => photoDialog.current?.showModal()} aria-label={`Enlarge photo of ${title}`}>{children}</button>
    );

  return (
    <section aria-label={`Room ${id}`} className="text-[#1f1f1f]">
      {/* The photo banner only appears when there is a photo, so empty rooms keep the card short. */}
      {heroImage ? (
        <div className="relative h-32 overflow-hidden">
          {photoControl("absolute inset-0", <>
            {/* Campus assets have no fixed dimensions; crop only the preview. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImage} alt="" className="h-full w-full object-cover" />
          </>)}
          {approved?.isDemo ? <span className="absolute top-2 right-2 rounded-full bg-amber-50/95 px-2.5 py-1 text-[11px] font-medium text-amber-950">Example photo</span> : null}
          {hasPanorama ? panoramaControl(pillClass, <><Glyph size={16}><ellipse cx="12" cy="12" rx="9" ry="4" /><path d="M12 3a4 9 0 0 1 0 18" /></Glyph>View in 360°</>) : null}
        </div>
      ) : null}

      <div className="flex items-start gap-3 px-5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="mt-0.5 text-[13px] text-[#5f6368]">{title !== id ? `${id} · ` : ""}{building} · {levelLabel}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close room details" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-[#5f6368] hover:bg-black/10">
          <Glyph><path d="M6 6l12 12M18 6 6 18" /></Glyph>
        </button>
      </div>

      <div className="flex justify-between px-4 pb-3">
        <button type="button" onClick={onDirections} className={actionClass}>
          <span className={`${circleBase} border-[#5b238a] bg-[#5b238a] text-white`}><Glyph><path d="M12 2 2 12l10 10 10-10z" /><path d="M9 14v-2a2 2 0 0 1 2-2h4" /><path d="m13 8 2 2-2 2" /></Glyph></span>
          Directions
        </button>
        <button type="button" onClick={onFrom} className={actionClass}>
          <span className={circleClass}><Glyph><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" /></Glyph></span>
          Start here
        </button>
        {hasPanorama ? (
          panoramaControl(actionClass, <><span className={circleClass}>{panoramaIcon}</span>360° view</>)
        ) : null}
        {onUpload ? (
          <button type="button" onClick={onUpload} className={actionClass}>
            <span className={circleClass}><Glyph><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Glyph></span>
            Add 360°
          </button>
        ) : null}
      </div>

      <div className="border-t border-black/10 py-1">
        <InfoRow icon={<Glyph><path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h.01M16 9h.01M8 13h.01M16 13h.01" /></Glyph>}>
          <span>{building}, {levelLabel}<br /><span className="text-[13px] text-[#5f6368]">{CAMPUS_ADDRESS}</span></span>
        </InfoRow>
        {stepFree ? (
          <InfoRow icon={<Glyph><circle cx="12" cy="4" r="1.6" /><path d="M12 7v6h5l2 5M9 10a6 6 0 1 0 7 8" /></Glyph>}>
            <span>Step-free: an elevator serves this floor</span>
          </InfoRow>
        ) : null}
        {media?.nearbyHallway ? (
          <InfoRow icon={<Glyph><path d="M4 20h4v-4h4v-4h4V8h4" /></Glyph>}>
            <span className="flex-1">Nearby hallway in 360°</span>
            <a className="font-semibold text-[#5b238a] underline-offset-2 hover:underline" href={media.nearbyHallway.viewerUrl} target="_blank" rel="noreferrer">View<span className="sr-only"> {media.nearbyHallway.name} (opens in a new tab)</span></a>
          </InfoRow>
        ) : null}
      </div>

      <div className="border-t border-black/10 px-5 pt-3 pb-4">
        <h3 className="mb-2 text-sm font-semibold">Photos &amp; 360°</h3>
        {heroImage ? (
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {photoControl(tileClass, <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt="" className="h-full w-full object-cover" />
            </>)}
          </div>
        ) : (
          <p className="text-[13px] text-[#5f6368]">
            No photos of this room yet.
            {onUpload ? <> <button type="button" onClick={onUpload} className="font-semibold text-[#5b238a] underline-offset-2 hover:underline">Add a 360° photo</button></> : null}
          </p>
        )}
      </div>

      {media?.photo ? (
        <dialog ref={photoDialog} className="photo-dialog m-auto max-h-[90dvh] w-[min(900px,92vw)] rounded-2xl bg-white p-4" aria-label={`Photo of ${title}`} onClick={(event) => { if (event.target === event.currentTarget) photoDialog.current?.close(); }}>
          <form method="dialog" className="mb-3 flex items-center justify-between gap-4"><p className="font-semibold">{title} · {building}</p><button className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-[#5b238a]">Back to map</button></form>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.photo.src} alt={media.photo.alt} className="max-h-[72dvh] w-full object-contain" />
        </dialog>
      ) : null}
    </section>
  );
}
