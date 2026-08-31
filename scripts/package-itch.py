#!/usr/bin/env python3
"""Build and validate a reproducible itch.io HTML5 release archive."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import zipfile


PROJECT_ROOT = Path(__file__).resolve().parent.parent
GAME_HTML = PROJECT_ROOT / "game" / "index.html"
GAME_ASSETS = (
    PROJECT_ROOT / "game" / "styles.css",
    PROJECT_ROOT / "game" / "game.js",
)
VERSION_FILE = PROJECT_ROOT / "VERSION"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "dist"
ZIP_MINIMUM_EPOCH = 315532800


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Package Sigil Strike as a deterministic itch.io HTML5 ZIP."
    )
    parser.add_argument(
        "--version",
        default=VERSION_FILE.read_text(encoding="utf-8").strip(),
        help="Release version (defaults to VERSION).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for the ZIP and checksum.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate source and archive without retaining release files.",
    )
    return parser.parse_args()


def validate_source(html: str, version: str) -> None:
    errors: list[str] = []
    if not GAME_HTML.is_file():
        errors.append(f"missing game entry point: {GAME_HTML}")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?", version):
        errors.append(f"version must use semantic versioning: {version!r}")
    if "<canvas" not in html.lower():
        errors.append("game entry point does not contain a canvas")
    if re.search(r"(?:src|href)=[\"']/(?!/)", html, re.IGNORECASE):
        errors.append("root-relative asset paths are not portable to itch.io")
    for asset in GAME_ASSETS:
        if not asset.is_file():
            errors.append(f"missing game asset: {asset}")
        if f'./{asset.name}' not in html:
            errors.append(f"game entry point does not reference {asset.name}")
    if errors:
        raise ValueError("\n".join(errors))


def zip_datetime() -> tuple[int, int, int, int, int, int]:
    raw_epoch = os.environ.get("SOURCE_DATE_EPOCH")
    epoch = int(raw_epoch) if raw_epoch else ZIP_MINIMUM_EPOCH
    epoch = max(epoch, ZIP_MINIMUM_EPOCH)
    stamp = time.gmtime(epoch)
    return stamp.tm_year, stamp.tm_mon, stamp.tm_mday, stamp.tm_hour, stamp.tm_min, stamp.tm_sec


def add_bytes(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=zip_datetime())
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content, compresslevel=9)


def build_archive(destination: Path, html: bytes, version: str) -> None:
    release_notes = (
        "SIGIL STRIKE\n"
        f"Version {version}\n\n"
        "Upload this ZIP as an HTML5 game on itch.io. The archive entry point is index.html.\n"
    ).encode("utf-8")
    with zipfile.ZipFile(destination, "w") as archive:
        add_bytes(archive, "index.html", html)
        for asset in GAME_ASSETS:
            add_bytes(archive, asset.name, asset.read_bytes())
        add_bytes(archive, "README.txt", release_notes)


def validate_archive(archive_path: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        expected_names = ["index.html", "styles.css", "game.js", "README.txt"]
        if names != expected_names:
            raise ValueError(f"unexpected archive contents: {names}")
        if archive.testzip() is not None:
            raise ValueError("archive integrity check failed")
        if not archive.read("index.html").lstrip().lower().startswith(b"<!doctype html"):
            raise ValueError("index.html is not a valid HTML entry point")


def write_checksum(archive_path: Path) -> Path:
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum_path = archive_path.with_suffix(archive_path.suffix + ".sha256")
    checksum_path.write_text(f"{digest}  {archive_path.name}\n", encoding="ascii")
    return checksum_path


def main() -> int:
    args = parse_args()
    html = GAME_HTML.read_bytes()
    validate_source(html.decode("utf-8"), args.version)

    if args.check:
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = Path(temp_dir) / "sigil-strike.zip"
            build_archive(archive_path, html, args.version)
            validate_archive(archive_path)
        print("Release source and archive validation passed.")
        return 0

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / f"sigil-strike-{args.version}-itch.zip"
    build_archive(archive_path, html, args.version)
    validate_archive(archive_path)
    checksum_path = write_checksum(archive_path)
    print(f"Built {archive_path}")
    print(f"SHA-256 {checksum_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Release build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
