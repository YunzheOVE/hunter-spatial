import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LevelControl } from "./LevelControl";
import { campusLevelsForSelection } from "../lib/campusLevels";

it("starts compact with descending low levels and keeps high selections visible", () => {
  const render = (floor: number) => renderToStaticMarkup(createElement(LevelControl, {
    levels: campusLevelsForSelection(null), floor, onSelect: () => {},
  }));
  const low = render(1);
  expect(low.match(/aria-pressed=/g)).toHaveLength(4);
  expect(low).toContain('aria-label="Concourse"');
  expect(low.indexOf('aria-label="Level 3"')).toBeLessThan(low.indexOf('aria-label="Level 1"'));
  expect(low).toContain('aria-expanded="false"');
  expect(render(18)).toContain('aria-label="Level 18" aria-pressed="true"');
});

it("offers building choice, outdoor view and marks levels on the active route", () => {
  const html = renderToStaticMarkup(createElement(LevelControl, {
    levels: campusLevelsForSelection("W"), floor: null, onSelect: () => {},
    buildingId: "W", onSelectBuilding: () => {}, onOutdoor: () => {}, routeLevels: [1, 2],
  }));
  expect(html).toContain('aria-label="Choose building: West Building"');
  expect(html).toContain('aria-label="Outdoor campus" aria-pressed="true"');
  expect(html).toContain('aria-label="Level 2, on route"');
  expect(html).not.toContain('aria-label="Level 3, on route"');
});
