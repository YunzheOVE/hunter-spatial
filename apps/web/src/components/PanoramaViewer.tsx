"use client";

import { useEffect, useRef, useState } from "react";
import { panoramaConfig, type PanoramaSource } from "@/lib/panorama";

export function PanoramaViewer({ panorama }: { panorama: PanoramaSource }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    let viewer: PannellumViewer | undefined;
    let observer: ResizeObserver | undefined;
    setStatus("loading");
    import("pannellum").then(() => {
      if (disposed || !container.current) return;
      if (!window.pannellum) throw new Error("Panorama viewer unavailable.");
      const config = () => panoramaConfig(panorama,
        container.current!.clientWidth / Math.max(1, container.current!.clientHeight));
      viewer = window.pannellum.viewer(container.current, config());
      viewer.on("load", () => { if (!disposed) setStatus("ready"); });
      viewer.on("error", () => { if (!disposed) setStatus("error"); });
      observer = new ResizeObserver(() => {
        if (!viewer || !container.current) return;
        viewer.resize();
        const bounds = config();
        viewer.setHfovBounds([bounds.minHfov, bounds.maxHfov]);
        if (viewer.getHfov() > bounds.maxHfov) viewer.setHfov(bounds.maxHfov, false);
      });
      observer.observe(container.current);
    }).catch(() => { if (!disposed) setStatus("error"); });
    return () => {
      disposed = true;
      observer?.disconnect();
      viewer?.destroy();
    };
  }, [panorama]);

  return (
    <div className="relative h-full min-h-0 bg-[#25212c]">
      <div ref={container} className="h-full w-full" aria-label="Interactive panorama. Drag to look around and scroll to zoom." />
      {status === "loading" ? <p role="status" className="pointer-events-none absolute top-3 left-3 rounded-lg bg-white/90 px-3 py-2 text-sm">Loading panorama…</p> : null}
      {status === "error" ? <div role="alert" className="absolute inset-0 flex items-center justify-center bg-[#25212c] p-5 text-center text-white">Unable to load this panorama. Close the viewer and try again.</div> : null}
    </div>
  );
}
