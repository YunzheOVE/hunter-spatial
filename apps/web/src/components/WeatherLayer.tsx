"use client";

import { useEffect, useRef } from "react";
import type { Weather } from "@/lib/mapScene";

type Drop = { x: number; y: number; speed: number; size: number; phase: number };

/** Falling rain streaks or snowflakes drawn on a canvas over the map. */
export function WeatherLayer({ weather, night }: { weather: Weather; night: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || weather === "clear") return;
    const rain = weather === "rain";
    let drops: Drop[] = [];
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round((width * height) / (rain ? 4500 : 6500));
      drops = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        speed: rain ? 700 + Math.random() * 500 : 30 + Math.random() * 50,
        size: rain ? 10 + Math.random() * 12 : 1.2 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const draw = (seconds: number, elapsed: number) => {
      context.clearRect(0, 0, width, height);
      context.strokeStyle = night ? "rgba(170,190,230,.45)" : "rgba(110,130,155,.45)";
      context.fillStyle = night ? "rgba(235,240,255,.85)" : "rgba(255,255,255,.92)";
      context.lineWidth = 1;
      context.beginPath();
      for (const drop of drops) {
        drop.y += drop.speed * elapsed;
        if (rain) drop.x += drop.speed * 0.12 * elapsed;
        if (drop.y > height + 20) { drop.y = -20; drop.x = Math.random() * width; }
        if (drop.x > width + 20) drop.x = -20;
        if (rain) {
          context.moveTo(drop.x, drop.y);
          context.lineTo(drop.x - drop.size * 0.12, drop.y - drop.size);
        } else {
          const sway = Math.sin(seconds * 1.3 + drop.phase) * 12;
          context.moveTo(drop.x + sway + drop.size, drop.y);
          context.arc(drop.x + sway, drop.y, drop.size, 0, Math.PI * 2);
        }
      }
      if (rain) context.stroke();
      else context.fill();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // With reduced motion, show a still frame of the weather instead of animating it.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(0, 0);
      return () => observer.disconnect();
    }
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      draw(time / 1000, Math.min(0.05, (time - last) / 1000));
      last = time;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      context.clearRect(0, 0, width, height);
    };
  }, [weather, night]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
