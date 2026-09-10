import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webRoot, "..", "..");

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(repoRoot, src)} -> ${path.relative(webRoot, dest)}`);
}

copy(
  path.join(repoRoot, "data", "campus.json"),
  path.join(webRoot, "src", "data", "campus.json"),
);
copy(
  path.join(repoRoot, "data", "rooms.json"),
  path.join(webRoot, "src", "data", "rooms.json"),
);
copy(
  path.join(repoRoot, "assets", "glb", "campus.glb"),
  path.join(webRoot, "public", "models", "campus.glb"),
);
copy(
  path.join(repoRoot, "assets", "glb", "floors", "N", "3-scan.glb"),
  path.join(webRoot, "public", "models", "floors", "N", "3-scan.glb"),
);
