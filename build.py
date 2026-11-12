"""Build a clean Busy Light firmware image without local user paths."""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SKETCH = ROOT / "BusyLight"
IMAGE = ROOT / "firmware_deploy.bin"


def check_ble_uuids() -> None:
    """Keep the published page and the firmware on the same BLE protocol."""
    firmware = (SKETCH / "BusyLight.ino").read_text(encoding="utf-8")
    page = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
    names = {
        "service": (r'serviceUuid\[\]\s*=\s*"([0-9a-f-]+)"', r"SERVICE_UUID\s*=\s*'([0-9a-f-]+)'"),
        "top": (r'topUuid\[\]\s*=\s*"([0-9a-f-]+)"', r"top:\s*'([0-9a-f-]+)'"),
        "front": (r'frontUuid\[\]\s*=\s*"([0-9a-f-]+)"', r"front:\s*'([0-9a-f-]+)'"),
    }
    for name, (firmware_pattern, page_pattern) in names.items():
        firmware_match = re.search(firmware_pattern, firmware, re.I)
        page_match = re.search(page_pattern, page, re.I)
        if not firmware_match or not page_match or firmware_match.group(1).lower() != page_match.group(1).lower():
            raise RuntimeError(f"BLE {name} UUID does not match between firmware and site/app.js")


def replace_hash(path: Path, pattern: str, digest: str) -> None:
    source = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, rf"\g<1>{digest}\g<2>", source)
    if count != 1:
        raise RuntimeError(f"Could not update SHA-256 in {path.name}")
    path.write_text(updated, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Busy Light for XIAO ESP32-C6")
    parser.add_argument("--arduino-cli", default="arduino-cli", help="Path to arduino-cli executable")
    options = parser.parse_args()

    executable = shutil.which(options.arduino_cli)
    if not executable:
        raise RuntimeError("Arduino CLI not found. Install it or pass --arduino-cli PATH")

    check_ble_uuids()

    user_home = str(Path.home())
    flags = " ".join(
        f"-ffile-prefix-map={prefix}=/arduino" for prefix in (user_home, "/" + user_home)
    )
    properties = [
        value
        for language in ("c", "cpp", "S")
        for value in ("--build-property", f"compiler.{language}.extra_flags={flags}")
    ]

    with tempfile.TemporaryDirectory(prefix="busy-light-build-") as temporary:
        output = Path(temporary)
        command = [
            executable,
            "compile",
            "--clean",
            "--fqbn",
            "esp32:esp32:XIAO_ESP32C6",
            *properties,
            "--output-dir",
            str(output),
            str(SKETCH),
        ]
        subprocess.run(command, check=True)
        merged = output / "BusyLight.ino.merged.bin"
        data = merged.read_bytes()

    if len(data) != 4_194_304:
        raise RuntimeError("Unexpected flash size in compiled image")
    if data[0] != 0xE9 or data[0x8000:0x8002] != b"\xaa\x50" or data[0x10000] != 0xE9:
        raise RuntimeError("Missing bootloader, partition table, or application")
    for start, end, name in (
        (0x9000, 0xE000, "NVS"),
        (0x150000, 0x290000, "app1"),
        (0x290000, 0x3F0000, "SPIFFS"),
        (0x3F0000, 0x400000, "coredump"),
    ):
        if any(byte != 0xFF for byte in data[start:end]):
            raise RuntimeError(f"{name} is not blank")
    if user_home.lower().encode() in data.lower():
        raise RuntimeError("The build contains the local user path")

    digest = hashlib.sha256(data).hexdigest().upper()
    IMAGE.write_bytes(data)
    replace_hash(ROOT / "flash.py", r'(IMAGE_SHA256 = ")[A-F0-9]{64}(")', digest)
    replace_hash(ROOT / "README.md", r'(Firmware SHA-256: `)[A-F0-9]{64}(`)', digest)
    print(f"Built {IMAGE.name} ({len(data)} bytes)")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
