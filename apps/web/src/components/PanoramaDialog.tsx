"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { PanoramaSource } from "@/lib/panorama";
import { PanoramaViewer } from "./PanoramaViewer";

export function PanoramaDialog({ title, locationId, onClose, children }: { title: string; locationId: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} aria-labelledby={headingId} className="panorama-dialog" onClose={onClose} onKeyDownCapture={(event) => {
      // Handle Escape before Pannellum's native keyboard listener captures it.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dialog.current?.close(); }
    }}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#5b238a]/15 px-4 py-3">
          <div className="min-w-0"><h2 id={headingId} className="truncate font-bold">{title}</h2><p className="text-xs text-[#555861]">{locationId}</p></div>
          <button type="button" autoFocus onClick={() => dialog.current?.close()} className="shrink-0 rounded-lg bg-[#f1edf4] px-3 py-2 text-sm font-semibold text-[#5b238a]" aria-label="Close panorama and return to map">Close</button>
        </header>
        {children}
        <footer className="shrink-0 px-4 py-2 text-xs text-[#555861]">Drag to look around · scroll or pinch to zoom · Escape to close</footer>
      </div>
    </dialog>
  );
}

export function PanoramaPreviewModal({ panorama, locationId, onClose }: { panorama: PanoramaSource; locationId: string; onClose: () => void }) {
  return <PanoramaDialog title="Panorama preview" locationId={locationId} onClose={onClose}><div className="min-h-0 flex-1"><PanoramaViewer panorama={panorama} /></div></PanoramaDialog>;
}
