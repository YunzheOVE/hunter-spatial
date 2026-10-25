"use client";

import { useEffect, useState } from "react";
import type { ApprovedPanorama } from "@/lib/panorama";
import { PanoramaViewer } from "./PanoramaViewer";
import { PanoramaDialog } from "./PanoramaDialog";

export function PanoramaModal({ locationId, title, onClose }: { locationId: string; title: string; onClose: () => void }) {
  const [panorama, setPanorama] = useState<ApprovedPanorama | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setPanorama(null);
    fetch(`/api/panoramas?locationId=${encodeURIComponent(locationId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Panorama request failed.");
        return response.json() as Promise<ApprovedPanorama | null>;
      })
      .then((data) => { if (!controller.signal.aborted) setPanorama(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [locationId]);

  return (
    <PanoramaDialog title={`${title} · 360° view`} locationId={locationId} onClose={onClose}>
        {panorama?.isDemo ? <p className="shrink-0 bg-amber-50 px-4 py-2 text-xs text-amber-950">Development example — not a verified photo of this room.</p> : null}
        <div className="min-h-0 flex-1">
          {loading ? <p role="status" className="p-6">Loading panorama…</p> : error ? <p role="alert" className="p-6">Unable to load the panorama. Close and try again.</p> : panorama ? <PanoramaViewer panorama={panorama} /> : <p role="status" className="p-6">No panorama available.</p>}
        </div>
    </PanoramaDialog>
  );
}
