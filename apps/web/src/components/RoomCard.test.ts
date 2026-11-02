import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomCard } from "./RoomCard";
import type { RoomMedia } from "../lib/roomMedia";

function render(media?: RoomMedia, extra: { stepFree?: boolean; onUpload?: () => void } = {}) {
  return renderToStaticMarkup(createElement(RoomCard, {
    id: "W305", locationId: "W305", name: "Classroom", building: "West Building", level: 3,
    media, stepFree: false, onDirections: () => {}, onFrom: () => {}, onClose: () => {}, onPanorama: () => {}, ...extra,
  }));
}

describe("room content availability", () => {
  it("keeps directions and location details without an empty image or tour button", () => {
    const html = render();
    expect(html).toContain("Directions");
    expect(html).toContain("West Building");
    expect(html).toContain("Level 3");
    expect(html).toContain("695 Park Ave");
    expect(html).toContain("No photos of this room yet");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("View in 360°");
  });

  it("invites a 360° upload when the room has no photos", () => {
    const html = render(undefined, { onUpload: () => {} });
    expect(html).toContain("Add a 360° photo");
    expect(html).toContain("Photos &amp; 360°");
  });

  it("shows the step-free row only when an elevator serves the floor", () => {
    expect(render(undefined, { stepFree: true })).toContain("Step-free");
    expect(render()).not.toContain("Step-free");
  });

  it("offers photo enlargement without advertising a panorama", () => {
    const html = render({ photo: { src: "/room.jpg", alt: "Classroom windows" } });
    expect(html).toContain("Enlarge photo");
    expect(html).toContain("<dialog");
    expect(html).not.toContain("View in 360°");
  });

  it("links hosted panoramas in a new tab and keeps nearby hallway tours distinct", () => {
    const html = render({ panorama: { preview: "/preview.jpg", viewerUrl: "https://example.com/tour" }, nearbyHallway: { name: "West entrance", viewerUrl: "https://example.com/hall" } });
    expect(html).toContain("View in 360°");
    expect(html).toContain("Nearby hallway in 360°");
    expect(html).toContain('href="https://example.com/tour"');
    expect(html).toContain('href="https://example.com/hall"');
  });
});
