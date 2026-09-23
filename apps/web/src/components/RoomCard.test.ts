import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomCard } from "./RoomCard";
import type { RoomMedia } from "../lib/roomMedia";

function render(media?: RoomMedia) {
  return renderToStaticMarkup(createElement(RoomCard, {
    id: "W305", name: "Classroom", building: "West Building", level: 3,
    media, onDirections: () => {}, onFrom: () => {}, onClose: () => {},
  }));
}

describe("room content availability", () => {
  it("keeps directions and location details without an empty image or tour button", () => {
    const html = render();
    expect(html).toContain("Directions");
    expect(html).toContain("West Building");
    expect(html).toContain("Level 3");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("View in 360°");
  });

  it("offers photo enlargement without advertising a panorama", () => {
    const html = render({ photo: { src: "/room.jpg", alt: "Classroom windows" } });
    expect(html).toContain("Enlarge photo");
    expect(html).toContain("<dialog");
    expect(html).not.toContain("View in 360°");
  });

  it("labels real panoramas and keeps nearby hallway tours distinct", () => {
    const html = render({ panorama: { preview: "/preview.jpg", viewerUrl: "https://example.com/tour" }, nearbyHallway: { name: "West entrance", viewerUrl: "https://example.com/hall" } });
    expect(html).toContain("View in 360°");
    expect(html).toContain("View nearby hallway");
    expect(html).toContain('href="https://example.com/tour"');
  });
});
