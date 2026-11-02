# 2026-11-01 — Map UI redesign (Google / Apple Maps layout) + room zoom fix

## Summary
- Redesigned how users interact with the campus map. The controls are rearranged to follow Google Maps (desktop) and Apple Maps (mobile, guidance). The 3D map rendering (MapView layers, colors, buildings) is unchanged.
- Fixed the camera so that picking a room zooms to it, and a calculated route is framed right away.
- The design was mocked up and approved before implementation (mockups on a Claude Design canvas, laid over screenshots of the real 3D map).

## What changed for users
- **Search-first flow.** The old Explore / Directions / Upload tabs are replaced by a single search bar (menu, search, Directions button). The panel switches between:
  - search results (Popular places when the search box is empty)
  - place details (photo or 360° preview, Directions / Start here / View in 360° / Add 360°)
  - directions
  - contribute (upload)
- **Category chips:** Classrooms, Restrooms, Food & lounges, 360° views. Each filters by room name or media, using only data that exists in `routing-graph.json`. Labs and Elevators were left out because the data has no matching rooms.
- **Floor picker** (right side, Apple indoor-maps style) now includes:
  - a building switcher (ALL / NORTH / EAST / WEST / THH / BAKER), which replaces the Building dropdown
  - an Outdoor button, which replaces "Outdoor campus"
  - dots on the levels the active route uses
- **Directions:** a Fastest / Step-free toggle replaces the wheelchair checkbox. Start/destination fields have a swap button. The route summary shows time, distance and stairs/step-free, with a Start button. Steps are grouped by building and level, and floor changes are highlighted.
- **Step-by-step guidance:** a large instruction banner at the top with a "Then …" line, and a trip bar at the bottom (time, distance, step X of N, progress bar, steps list, Previous / Next / Finish, End).
- **Account button** (top-right): shows "Sign in", or the user's initial when signed in, and opens the Contribute panel.
- **Mobile:** the panel is a bottom sheet with a grab handle to expand or collapse it. Zoom buttons are hidden on phones (pinch to zoom). The map attribution moves to the top-left so the sheet doesn't cover it.
- **Hunter wordmark** in the map corner. This is a placeholder until the official logo file is added.

## Zoom bug: cause and fix
- Cause: `MapView` only moved the camera during step-by-step navigation. A comment there said exploring should never move the camera. So searching for a room switched the floor but left the camera at campus zoom.
- Fix (`MapView.tsx`):
  - New `fitRoom()` fits the camera to the selected room's polygon from `hunter-floors.geojson` (max zoom 19.2).
  - Route framing now runs as soon as a route is calculated, not only after Start.
  - New `cameraPadding()` keeps targets clear of the overlay: the 400px left panel on desktop, the bottom sheet on phones, and the floor picker on the right.

## Files touched
- `apps/web/src/components/CampusApp.tsx`: layout rewrite (panels, search bar, chips, guidance banner and trip bar, bottom sheet, account button). Routing, search and suggestion logic kept as it was.
- `apps/web/src/components/MapView.tsx`: camera fix (`cameraPadding`, `fitRoom`, route preview framing).
- `apps/web/src/components/LevelControl.tsx`: building switcher, outdoor button, on-route dots, new styling.
- `apps/web/src/components/RoomCard.tsx`: now panel content (hero image, round action buttons).
- `apps/web/src/components/UploadPanel.tsx`: sign-in session lifted into CampusApp (props `user`, `checkingSession`, `sessionError`, `onUserChange`); restyled.
- `apps/web/src/components/UserLogin.tsx`: restyled inputs and buttons.
- `apps/web/src/components/WayfindingIcon.tsx`: added a shared `Glyph` icon wrapper.
- `apps/web/src/app/layout.tsx`, `globals.css`: Inter font; map control and attribution styling.
- `apps/web/src/components/LevelControl.test.ts`: new test for the building switcher, outdoor button and on-route levels.
- `.claude/launch.json`: dev server entry for the in-app browser preview.

## Verification
- `tsc --noEmit` clean; `vitest`: 61/61 tests pass; `next lint`: no warnings.
- Checked by hand in the browser at 1280×800 and 390×844:
  - explore
  - search → W305 (camera zooms to the room)
  - directions W305 → W502 (1 min · 70 m, elevator then stairs; route framed automatically)
  - guidance and the step list
  - the mobile home and place sheets

## Follow-up polish (same day)
- **Official Hunter logo:** `apps/web/public/hunter-logo.svg`, taken from hunter.cuny.edu/assets/hunter-logo-white.v2.svg and recolored to Hunter Purple `#5F259F`. Hunter's identity guide allows only purple or black on light backgrounds. The logo is fixed bottom-left on desktop and top-left on phones; on phones it's hidden during step-by-step guidance, where the banner needs the full width.
- **Left panel:** it's now 380px wide and sizes to its content, capped at `100dvh − 112px` so it never covers the logo. Before, it stretched to the bottom of the screen.
- **Translucent cards:** every floating card is frosted glass (`bg-white/75` + backdrop blur): the search panel and bottom sheet, chips, floor picker, building menu, trip bar, map zoom controls and the logo card. The guidance banner is 85% opaque purple. Fills inside the cards are translucent too.
- **Researched indoor-map patterns** (Google Maps indoor, Mapbox indoor, Apple MapKit/IMDF) and wrote down options for an easier building/floor switcher. Not implemented yet.

## Map visuals, high-floor zoom and travel time (same day)
- **Campus in context (outdoor):** surrounding Manhattan buildings now render as soft grey 3D, from basemap building heights. Basemap copies of Hunter's own buildings are excluded by ID so they don't flicker against ours. Hunter buildings have a lighter purple facade and a pale roof cap. Added gentle directional light and a sky gradient at the horizon. The grey neighbors are outdoor-only, so they don't block floor plans indoors.
- **Selected room:** stays green, and now also pulses with a glow, shows a faint green light beam above it, and has a floating room-number label. The pulse is skipped when the user has reduced motion turned on.
- **Map icons:**
  - The hand-drawn canvas badges are replaced by SVG icons, which are crisper and much shorter code.
  - New lounge icon; rooms named lounge, café or dining get the food & lounge icons.
  - Classrooms show as small dots until zoom 18.6, then switch to book icons, so restrooms, food, stairs and elevators stand out.
- **High-floor zoom bug:** selecting a room on an upper floor framed the middle of the building. Cause: `fitBounds` aims at the ground, but Level 18 is 59.5 m up, and under a tilted camera that height shifts the room off-center. Fix: `fitElevated()` moves the target `h·tan(pitch)` along the view direction (exact for the screen center) and zooms out by `log2(1 + h / (cos(pitch)·cameraDistance))`. MapLibre's built-in center elevation was tried first and dropped: without terrain, `easeTo` ignores it and nearby 3D geometry gets clipped.
- **Travel time:** time was distance ÷ 1.2 m/s, so a staircase floor counted as about 3 seconds. New `edgeSeconds()` model:
  - walking 1.2 m/s
  - stairs 16 s per floor up, 11 s per floor down
  - elevator 30 s wait + 4 s per floor
  - escalator 10 s per floor

  Route choice uses the same model, so long vertical trips now prefer elevators. Example: E1802 → W1804 went from "4 min, 11 floors down and 11 up by stairs" to "5 min, elevators both ways". Each floor-change step now shows its own estimate ("Under a minute" / "About 1 min").
- Tests: 63/63 pass, including new tests for the time model and the E1802 → W1804 route.

## Open items / next steps
- Building/floor switching: tap-a-building was mocked up and set aside, because many buildings are connected and a per-building view gets in the way.
- Time constants are estimates; calibrate them by timing a few real routes on campus.
- The mobile sheet has two fixed heights (46% and 85%); there's no drag gesture yet.
- The Contribute panel still uses the original form layout, restyled (no drag-and-drop zone or segmented coverage control yet).
- Not yet tested on a real phone or with a screen reader.
