"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CAMPUS_BUILDING_NAMES, type RoutingGraphData } from "@/lib/pathfinding";
import type { PanoramaSource } from "@/lib/panorama";
import { coverageError, panoramaFileError, panoramaDimensionsError, type SessionUser, type Submission } from "@/lib/uploads";
import { PanoramaPreviewModal } from "./PanoramaDialog";
import { UserLogin } from "./UserLogin";

const inputClass = "mt-1 w-full rounded-xl border border-[#dedfe3] bg-white/90 px-3 py-2.5 text-sm text-[#2f3137]";
const primaryClass = "rounded-xl bg-[#5b238a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4b1d72] disabled:opacity-50";
const secondaryClass = "rounded-xl border border-[#5b238a]/30 bg-white/70 px-3 py-2 text-sm font-semibold text-[#5b238a] disabled:opacity-50";

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "Unable to complete the request. Please try again." }));
  if (!response.ok) throw new ApiError(body.error ?? "Please try again.", response.status);
  return body;
}

export function UploadPanel({ graph, initialLocationId, locationsError }: { graph: RoutingGraphData | null; initialLocationId: string | null; locationsError: boolean }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState(initialLocationId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageReadError, setImageReadError] = useState("");
  const [preset, setPreset] = useState("full");
  const [coverage, setCoverage] = useState({ haov: "360", vaov: "180", vOffset: "0" });
  const [preview, setPreview] = useState<{ locationId: string; panorama: PanoramaSource } | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [listError, setListError] = useState("");
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<{ user: SessionUser | null }>("/api/auth/session", { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) setUser(body.user); })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to check sign-in. Refresh the page to try again."); })
      .finally(() => { if (!controller.signal.aborted) setCheckingSession(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!file) { setLocalUrl(""); return; }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    const image = new Image();
    image.onload = () => setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setImageReadError("Unable to read this image. Choose another JPEG, PNG, or WebP.");
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!user) { setSubmissions([]); return; }
    const controller = new AbortController();
    setLoadingList(true);
    setListError("");
    api<{ submissions: Submission[] }>("/api/submissions", { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) setSubmissions(body.submissions); })
      .catch((failure) => { if (!controller.signal.aborted) setListError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingList(false); });
    return () => controller.abort();
  }, [user]);

  const options = useMemo(() => Object.entries(graph?.rooms ?? {}).map(([id, room]) => ({
    id, label: `${id}${room.name !== id ? ` — ${room.name}` : ""} · ${CAMPUS_BUILDING_NAMES[room.building] ?? room.building} · ${room.level === 0 ? "Concourse" : `Floor ${room.level}`}`,
  })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [graph]);
  const matching = options.filter((option) => option.id === locationId || option.label.toLowerCase().includes(search.trim().toLowerCase()));
  const validLocation = Boolean(graph && Object.hasOwn(graph.rooms, locationId));
  const viewingError = Object.values(coverage).some((value) => !value.trim()) ? "Enter each coverage value." : coverageError(Number(coverage.haov), Number(coverage.vaov), Number(coverage.vOffset));
  const checkingImage = Boolean(file && !dimensions && !imageReadError);
  const imageError = imageReadError || (dimensions ? panoramaDimensionsError(dimensions.width, dimensions.height, Number(coverage.haov) === 360 && Number(coverage.vaov) === 180) : null);

  function clearFile() { setFile(null); setDimensions(null); setImageReadError(""); setPreview(null); if (fileInput.current) fileInput.current.value = ""; }
  function showError(failure: unknown) {
    setError(failure instanceof Error ? failure.message : "Please try again.");
    if (failure instanceof ApiError && failure.status === 401) { setUser(null); clearFile(); }
  }

  async function signOut() {
    setBusy(true); setError(""); setNotice("");
    try { await api("/api/auth/sign-out", { method: "POST" }); setUser(null); clearFile(); }
    catch (failure) { showError(failure); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    if (!validLocation || !file || viewingError || checkingImage || imageError) { setError(imageError ?? viewingError ?? (checkingImage ? "Wait for the image check to finish." : "Choose an image and a location from the list.")); return; }
    const form = new FormData();
    form.set("locationId", locationId); form.set("image", file);
    for (const [key, value] of Object.entries(coverage)) form.set(key, value);
    setBusy(true);
    try {
      const body = await api<{ submission: Submission }>("/api/submissions", { method: "POST", body: form });
      setSubmissions((current) => [body.submission, ...current]);
      clearFile();
      setNotice("Submitted for review. Your panorama will appear on the map after approval.");
    } catch (failure) { showError(failure); }
    finally { setBusy(false); }
  }

  async function refreshSubmissions() {
    setLoadingList(true); setListError("");
    try { setSubmissions((await api<{ submissions: Submission[] }>("/api/submissions")).submissions); }
    catch (failure) { setListError(failure instanceof Error ? failure.message : "Unable to load submissions."); if (failure instanceof ApiError && failure.status === 401) { setUser(null); clearFile(); } }
    finally { setLoadingList(false); }
  }

  return <section aria-label="Panorama uploads" className="mt-4 space-y-4 text-sm">
    <div><h2 className="text-base font-bold text-[#2f3137]">Share a campus panorama</h2><p className="mt-1 text-xs leading-5 text-[#555861]">Choose a location and submit your panorama for review.</p></div>
    {checkingSession ? <p role="status">Checking sign-in…</p> : !user ? <UserLogin onSignIn={(signedInUser) => { setUser(signedInUser); setError(""); setNotice(""); }} /> : <>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-white/70 p-3"><p className="min-w-0 break-words text-xs">Signed in as <strong>{user.name}</strong></p><button type="button" className="shrink-0 text-xs font-semibold text-[#5b238a] underline" onClick={signOut} disabled={busy}>Sign out</button></div>
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div><label className="block" htmlFor="upload-location-search">Find a room or location</label><input id="upload-location-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLocationId(""); }} className={inputClass} placeholder="Search room, name, or building" /></div>
          <div><label className="block" htmlFor="upload-location">Location <span aria-hidden="true">*</span></label><select id="upload-location" className={inputClass} value={locationId} onChange={(event) => setLocationId(event.target.value)} required disabled={!graph}>
            <option value="">Select a room or location</option>{matching.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>{!graph ? <p role="status" className="mt-1 text-xs">{locationsError ? "Unable to load locations. Refresh the page to try again." : "Loading campus locations…"}</p> : !matching.length ? <p role="status" className="mt-1 text-xs">No matching locations.</p> : null}</div>
          <div id="upload-guidelines" className="rounded-xl bg-white/70 p-3 text-xs leading-5 text-[#555861]">
            <p className="font-semibold text-[#2f3137]">Upload guidelines</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Upload a clear, well-lit panorama matching the selected campus location.</li>
              <li>Use an already-stitched panorama; ordinary photos won’t be converted.</li>
              <li>For a full-sphere panorama, use a <strong>2:1 image</strong>, such as <strong>4000 × 2000 pixels</strong>, covering <strong>360° horizontally and 180° vertically</strong>.</li>
              <li>Avoid identifiable people and readable personal information.</li>
              <li>Use JPEG, PNG, or WebP, up to <strong>20 MB and 64 megapixels</strong>.</li>
              <li>Preview before submitting to check for gaps, distortion, or mismatched edges.</li>
            </ul>
          </div>
          <label className="block">Panorama image <span aria-hidden="true">*</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="upload-guidelines upload-image-check" aria-invalid={Boolean(imageError)} className={`${inputClass} file:mr-2 file:rounded-md file:border-0 file:bg-[#f1edf4] file:px-2 file:py-1 file:text-[#5b238a]`} onChange={(event) => {
            const selected = event.target.files?.[0]; setError(""); setNotice("");
            setDimensions(null); setImageReadError("");
            const invalid = selected ? panoramaFileError(selected) : null;
            if (invalid) { clearFile(); setImageReadError(invalid); return; }
            setFile(selected ?? null);
          }} /></label>
          <div id="upload-image-check" aria-live="polite" className="text-xs leading-5">
            {checkingImage ? <p role="status">Checking image…</p> : imageError ? <p role="alert" className="text-[#b3261e]">{imageError}</p> : dimensions ? <p className="text-[#555861]">{dimensions.width} × {dimensions.height} pixels. Technical checks passed; location, quality, and privacy still require review.</p> : null}
          </div>
          <label className="block">Image coverage<select className={inputClass} value={preset} onChange={(event) => { setPreset(event.target.value); setCoverage(event.target.value === "full" ? { haov: "360", vaov: "180", vOffset: "0" } : { haov: "270", vaov: "90", vOffset: "0" }); }}><option value="full">Full sphere (360° × 180°)</option><option value="partial">Partial panorama</option></select></label>
          {preset === "full" ? <p className="text-xs leading-5 text-[#555861]">You selected Full sphere (360° horizontally × 180° vertically). Your image must have a 2:1 width-to-height ratio, such as 4000 × 2000 pixels.</p> : null}
          {preset === "partial" ? <div className="space-y-2 rounded-xl bg-white/60 p-3">
            <label className="block text-xs">Horizontal coverage (degrees)<input type="number" className={inputClass} min="1" max="360" step="any" required value={coverage.haov} onChange={(event) => setCoverage({ ...coverage, haov: event.target.value })} /></label>
            <label className="block text-xs">Vertical coverage (degrees)<input type="number" className={inputClass} min="1" max="180" step="any" required value={coverage.vaov} onChange={(event) => setCoverage({ ...coverage, vaov: event.target.value })} /></label>
            <label className="block text-xs">Vertical offset (degrees)<input type="number" className={inputClass} min="-90" max="90" step="any" required value={coverage.vOffset} onChange={(event) => setCoverage({ ...coverage, vOffset: event.target.value })} /></label>
            {viewingError ? <p className="text-xs text-[#b3261e]">{viewingError}</p> : null}
          </div> : null}
          <div className="flex flex-wrap gap-2"><button type="button" className={secondaryClass} disabled={!localUrl || !validLocation || Boolean(viewingError) || checkingImage || Boolean(imageError)} onClick={() => setPreview({ locationId, panorama: { imageUrl: localUrl, haov: Number(coverage.haov), vaov: Number(coverage.vaov), vOffset: Number(coverage.vOffset) } })}>Preview panorama</button><button className={primaryClass} disabled={!validLocation || !file || Boolean(viewingError) || checkingImage || Boolean(imageError)}>{busy ? "Submitting…" : "Submit for review"}</button></div>
        </fieldset>
      </form>
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">{notice}</p> : null}
      <section aria-label="My submissions" className="border-t border-[#5b238a]/15 pt-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold">My submissions</h3><button type="button" className="text-xs font-semibold text-[#5b238a] underline" disabled={loadingList || busy} onClick={refreshSubmissions}>Refresh</button></div>
        {loadingList ? <p role="status" className="mt-2 text-xs">Loading submissions…</p> : listError ? <p role="alert" className="mt-2 text-xs text-[#b3261e]">{listError}</p> : !submissions.length ? <p className="mt-2 text-xs text-[#555861]">No submissions yet.</p> : <ul className="mt-2 space-y-2">{submissions.map((submission) => <li key={submission.id} className="rounded-xl bg-white/80 p-3">
          <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-semibold">{submission.locationId}</span><span className={`shrink-0 rounded-full px-2 py-1 text-xs capitalize ${submission.status === "approved" ? "bg-emerald-100 text-emerald-900" : submission.status === "rejected" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"}`}>{submission.status}</span></div>
          <p className="mt-1 text-xs text-[#555861]">{graph?.rooms[submission.locationId]?.name}</p><time className="mt-1 block text-xs text-[#555861]" dateTime={`${submission.uploadedAt.replace(" ", "T")}Z`}>{new Date(`${submission.uploadedAt.replace(" ", "T")}Z`).toLocaleString()}</time>
          <button type="button" className="mt-2 text-xs font-semibold text-[#5b238a] underline" onClick={() => setPreview({ locationId: submission.locationId, panorama: submission })}>Preview submission</button>
        </li>)}</ul>}
      </section>
    </>}
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-[#b3261e]">{error}</p> : null}
    {preview ? <PanoramaPreviewModal panorama={preview.panorama} locationId={preview.locationId} onClose={() => setPreview(null)} /> : null}
  </section>;
}
