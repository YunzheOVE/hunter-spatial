"""Write Mappedin JSON/zip bodies from a local HAR into data/raw/."""

from __future__ import annotations

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"

HAR_CANDIDATES = (
    DATA_DIR / "hunter.har",
    DATA_DIR / "hunter_campus.har",
)


def find_har() -> Path:
    for path in HAR_CANDIDATES:
        if path.exists():
            return path
    found = sorted(DATA_DIR.glob("*.har"))
    if not found:
        raise SystemExit(f"No HAR in {DATA_DIR}. Save Hunter's map archive as data/hunter.har")
    return found[0]


def body_bytes(content: dict) -> bytes:
    text = content.get("text") or ""
    if content.get("encoding") == "base64":
        return base64.b64decode(text)
    return text.encode("utf-8")


def extract(har_path: Path, dest: Path) -> dict[str, Path]:
    har = json.loads(har_path.read_text(encoding="utf-8"))
    dest.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for entry in har["log"]["entries"]:
        url = entry.get("request", {}).get("url", "").split("?")[0]
        content = entry.get("response", {}).get("content") or {}
        if not content.get("text"):
            continue
        if "/polygon/" in url:
            name = "polygon.json"
        elif "/location/" in url:
            name = "location.json"
        elif "/map/" in url and "/maps/" not in url:
            name = "map.json"
        elif url.endswith(".zip") and "mappedin.com" in url:
            name = "venue.zip"
        else:
            continue
        target = dest / name
        target.write_bytes(body_bytes(content))
        written[name] = target
    missing = {"polygon.json", "location.json", "map.json"} - set(written)
    if missing:
        raise SystemExit(f"HAR missing Mappedin payloads: {sorted(missing)}")
    return written


def main() -> None:
    har_path = find_har()
    written = extract(har_path, RAW_DIR)
    print("from", har_path)
    for name, path in written.items():
        print(f"  {name} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
