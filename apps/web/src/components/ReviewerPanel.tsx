"use client";

import { useEffect, useState } from "react";
import { CAMPUS_BUILDING_NAMES, type RoutingGraphData } from "@/lib/pathfinding";
import type { ReviewSubmission } from "@/lib/uploads";
import { PanoramaPreviewModal } from "./PanoramaDialog";

export function ReviewerPanel({ graph, onSessionExpired }: { graph: RoutingGraphData | null; onSessionExpired: () => void }) {
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<ReviewSubmission | null>(null);

  async function load(signal?: AbortSignal) {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/reviews", { cache: "no-store", signal });
      const body = await response.json();
      if (signal?.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) throw new Error(body.error);
      setSubmissions(body.submissions);
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Unable to load reviews.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // Load once when this signed-in review panel mounts; subsequent refreshes are manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(id: number, decision: "approved" | "rejected") {
    setSaving(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/reviews/${id}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = await response.json();
      if (response.status === 401) { onSessionExpired(); return; }
      if (response.status === 409) { await load(); setError(body.error); return; }
      if (!response.ok) throw new Error(body.error);
      setSubmissions((current) => current.filter((submission) => submission.id !== id));
      setNotice(`Submission ${decision}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save the decision."); }
    finally { setSaving(null); }
  }

  return <section aria-label="Review submissions" className="space-y-3 border-t border-[#5b238a]/15 pt-3">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">Review submissions</h3><button type="button" disabled={loading || saving !== null} onClick={() => void load()} className="text-xs font-semibold text-[#5b238a] underline disabled:opacity-50">Refresh</button></div>
    <p className="text-xs leading-5 text-[#555861]">Check location accuracy, clarity, stitching, coverage, and privacy before approving.</p>
    {error ? <p role="alert" className="text-xs text-[#b3261e]">{error}</p> : null}
    {notice ? <p role="status" className="text-xs text-emerald-900">{notice}</p> : null}
    {loading ? <p role="status">Loading reviews…</p> : !submissions.length && !error ? <p className="text-xs text-[#555861]">No pending submissions.</p> : <ul className="space-y-2">{submissions.map((submission) => {
      const room = graph?.rooms[submission.locationId];
      const date = `${submission.uploadedAt.replace(" ", "T")}Z`;
      return <li key={submission.id} className="space-y-2 rounded-xl bg-white/80 p-3">
        <p className="break-words font-semibold">{submission.locationId}{room && room.name !== submission.locationId ? ` — ${room.name}` : ""}</p>
        <p className="text-xs text-[#555861]">{room ? `${CAMPUS_BUILDING_NAMES[room.building] ?? room.building} · ${room.level === 0 ? "Concourse" : `Floor ${room.level}`}` : "Location details unavailable."}</p>
        <p className="break-words text-xs">Uploaded by {submission.uploaderName} · <time dateTime={date}>{new Date(date).toLocaleString()}</time></p>
        <p className="text-xs">Coverage: {submission.haov}° horizontal × {submission.vaov}° vertical · Offset: {submission.vOffset}°</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPreview(submission)} className="rounded-lg border border-[#5b238a]/30 px-3 py-2 text-xs font-semibold text-[#5b238a]">Preview panorama</button>
          <button type="button" disabled={saving !== null} onClick={() => void decide(submission.id, "approved")} className="rounded-lg bg-[#5b238a] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button>
          <button type="button" disabled={saving !== null} onClick={() => void decide(submission.id, "rejected")} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-900 disabled:opacity-50">Reject</button>
        </div>
        {saving === submission.id ? <p role="status" className="text-xs">Saving decision…</p> : null}
      </li>;
    })}</ul>}
    {preview ? <PanoramaPreviewModal panorama={preview} locationId={preview.locationId} onClose={() => setPreview(null)} /> : null}
  </section>;
}
