"""Flash the clean Busy Light build to a 4 MB XIAO ESP32-C6 board."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import re
import subprocess
import sys
import tempfile
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


IMAGE = Path(__file__).resolve().parent / "firmware_deploy.bin"
IMAGE_SIZE = 4_194_304
IMAGE_SHA256 = "701F81CAD26FCD519F9DD7E45266E4719494BAB231FEA078B0CAB5BADF4E3267"


def check_image() -> None:
    if not IMAGE.is_file():
        raise RuntimeError(f"Не найден файл прошивки: {IMAGE}")
    if IMAGE.stat().st_size != IMAGE_SIZE:
        raise RuntimeError("Размер файла прошивки не совпадает с ожидаемым (4 МБ).")
    digest = hashlib.sha256(IMAGE.read_bytes()).hexdigest().upper()
    if digest != IMAGE_SHA256:
        raise RuntimeError("Контрольная сумма прошивки не совпадает. Запись остановлена.")


def normalize_port(value: str) -> str:
    port = value.strip()
    if re.fullmatch(r"COM\d+", port, re.IGNORECASE):
        return port.upper()
    if port.startswith("/dev/") and len(port) > 5 and not any(char.isspace() for char in port):
        return port
    raise RuntimeError("Укажите последовательный порт платы: COM12 или /dev/ttyACM0.")


def choose_port() -> str:
    from serial.tools import list_ports

    print("Доступные порты:")
    for port in list_ports.comports():
        print(f"  {port.device}: {port.description}")
    return normalize_port(input("Введите порт ESP32-C6 (например, COM12 или /dev/ttyACM0): "))


def esptool(port: str, command: str, *arguments: str, capture: bool = False) -> str:
    baud = "460800" if command in {"write-flash", "verify-flash"} else "115200"
    args = [
        sys.executable,
        "-m",
        "esptool",
        "--chip",
        "esp32c6",
        "--port",
        port,
        "--baud",
        baud,
        command,
        *arguments,
    ]
    result = subprocess.run(
        args,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    if result.returncode:
        output = result.stdout or ""
        raise RuntimeError(f"Ошибка esptool ({result.returncode}).\n{output}")
    return result.stdout or ""


def verify_static_flash(port: str) -> None:
    """Check the written image except NVS, which the running firmware updates."""
    data = IMAGE.read_bytes()
    with tempfile.TemporaryDirectory(prefix="busy-light-verify-") as directory:
        temporary = Path(directory)
        before_nvs = temporary / "before_nvs.bin"
        after_nvs = temporary / "after_nvs.bin"
        before_nvs.write_bytes(data[:0x9000])
        after_nvs.write_bytes(data[0xE000:])
        esptool(
            port,
            "verify-flash",
            "0x0",
            str(before_nvs),
            "0xE000",
            str(after_nvs),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Прошить новую ESP32-C6 (4 МБ).")
    parser.add_argument("port", nargs="?", help="порт платы, например COM12 или /dev/ttyACM0")
    parser.add_argument("--check-only", action="store_true", help="Проверить плату без записи")
    options = parser.parse_args()

    check_image()
    if importlib.util.find_spec("esptool") is None:
        raise RuntimeError("Не найден esptool. Установите: py -m pip install -r requirements.txt")

    port = normalize_port(options.port) if options.port else choose_port()

    print(f"Проверка платы на {port}...", flush=True)
    flash_info = esptool(port, "flash-id", capture=True)
    print(flash_info, flush=True)
    if not re.search(r"Detected flash size:\s*4MB\b", flash_info):
        raise RuntimeError("Нужна плата ESP32-C6 с флеш-памятью 4 МБ.")
    security = esptool(port, "get-security-info", capture=True)
    if not re.search(r"Secure Boot:\s*Disabled", security) or not re.search(
        r"Flash Encryption:\s*Disabled", security
    ):
        raise RuntimeError("На плате включена защита загрузки или шифрование флеш-памяти.")

    if options.check_only:
        print("Проверки прошли. Запись не запускалась.")
        return 0

    print("Внимание: будут перезаписаны все 4 МБ флеш-памяти выбранной платы.")
    confirmation = normalize_port(input(f"Чтобы продолжить, введите {port}: "))
    if confirmation != port:
        raise RuntimeError("Запись отменена.")

    print("Запись прошивки...", flush=True)
    esptool(port, "write-flash", "0x0", str(IMAGE))
    print("Проверка записанных данных (кроме изменяемого раздела NVS)...", flush=True)
    verify_static_flash(port)
    print("Готово. Плата прошита и проверена.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, KeyboardInterrupt, EOFError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        raise SystemExit(1)
