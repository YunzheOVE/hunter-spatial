import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
  console.log("copied", file);
}
