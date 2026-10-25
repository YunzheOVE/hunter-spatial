# Room imagery

Approved uploaded panoramas now have a separate runtime path: room details open
the Pannellum modal, which fetches metadata from `/api/panoramas?locationId=...`
and image bytes from the backend. See the root `database/README.md` for setup.
The static catalog below remains for legacy photo/tour entries; runtime badges
and the panorama filter will be connected in the final integration phase.

Add verified campus imagery to `ROOM_MEDIA` in `roomMedia.ts`, keyed by the
canonical room ID from the routing graph. The catalog starts empty because this
repository does not contain room photos or interactive tours.

An entry can contain any of these optional fields:

```ts
W305: {
  photo: { src: "/rooms/w305.jpg", alt: "Describe the actual room photo" },
  panorama: {
    preview: "/rooms/w305-preview.jpg",
    viewerUrl: "https://your-tour-host.example/w305",
  },
  nearbyHallway: {
    name: "West Building, level 3",
    viewerUrl: "https://your-tour-host.example/west-level-3",
  },
},
```

This is a format example, not a claim that W305 has imagery. Store local photos
under `apps/web/public/rooms/`. Tour URLs must open a working interactive viewer;
raw panoramic images are not rendered as 360° tours by this app. Tours open in a
new tab, retaining the map state. Regular photos open in a native dialog with
Escape and Back to map controls. Nearby hallways are labeled separately and do
not make a room appear in the 360° locations filter.
