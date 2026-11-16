<p align="center">
  <img src="data/logo/hunter-spatial-symbol.png" alt="Hunter Spatial logo" width="96" />
</p>

<h1 align="center">Hunter Spatial</h1>

<p align="center">
  <strong>A 3D campus map and indoor directions for CUNY Hunter College.</strong><br />
  Search for rooms, switch floors, and find your way around the 68th Street campus.
</p>

<p align="center">
  <a href="https://hunter-spatial-web.vercel.app"><strong>Open the map</strong></a> ·
  <a href=".github/readme/campus-demo.mp4?raw=true">Demo video (MP4)</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset=".github/readme/campus-map.png" />
    <img src=".github/readme/campus-demo.gif" alt="Hunter Spatial demo showing a room search and a step-free route from W117 through a skybridge to TH114." width="900" />
  </picture>
</p>

## Try it

- **Find a room in 3D.** Search for `TH114` to jump to its floor in Thomas Hunter Hall.
- **Get indoor directions.** Try `W117` to `TH114` and select **Step-free** to follow a route via elevators and skybridges.
- **Explore the campus.** Open the scene controls at the bottom of the outdoor map to change the time of day, weather, and season.
- **Take the first-week tour.** Find it in the map menu to visit spots like the OneCard Office and Cooperman Library.

### Campus scenes

| Autumn at golden hour | A snowy winter night |
| :---: | :---: |
| ![Hunter's 3D campus in warm evening light beside Central Park's autumn colors](.github/readme/explore-autumn.jpg) | ![Hunter's 3D campus at night with falling snow and snow on the roofs](.github/readme/explore-snow.jpg) |

## Quick start

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Run tests with `npm test`.
For optional setup, see [360° photos](database/README.md) and [rebuilding map data](data/SOURCE.md).

## How it works

![System diagram showing how prepared floor plans power the 3D map and indoor routing in the browser, and how a separate server delivers approved 360° photos on request.](docs/system-architecture.svg)

[Tech stack](stack.md) · [Routing flowchart](stack.md#route-request-flow) · [Project plan](plan.md)
