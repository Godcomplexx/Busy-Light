# Busy Light Firmware for XIAO ESP32-C6

This project contains an editable Arduino sketch, a complete firmware image, and a static Web Bluetooth controller for the **Seeed Studio XIAO ESP32-C6 with 4 MB of flash**. A compatible browser can find a nearby board, connect over Bluetooth Low Energy (BLE), and set the top indicator and five front LEDs independently. The color controls need no Wi-Fi network, account, or cable after the initial USB flash.

## Files

- `BusyLight/BusyLight.ino` — editable application source code.
- `firmware_deploy.bin` — complete 4 MB flash image built from that source.
- `build.py` — privacy-aware firmware builder.
- `flash.py` — Python script that checks a board, writes the image, and verifies it.
- `requirements.txt` — `esptool==5.3.0` for flashing.
- `site/index.html` and `site/app.js` — static Web Bluetooth page for localhost or GitHub Pages.
- `.github/workflows/pages.yml` — publishes only the `site` folder to GitHub Pages when this project is pushed to a repository's default branch.
- `.gitignore` and `.gitattributes` — keep temporary files out of Git and mark the firmware image as binary.
- `tests/site.test.mjs` — checks browser state when Bluetooth connections change; runs with Node.js and no npm packages.

Firmware SHA-256: `701F81CAD26FCD519F9DD7E45266E4719494BAB231FEA078B0CAB5BADF4E3267`. `flash.py` checks this hash before writing.

## Flash a Board

Install Python 3. Open a terminal in this folder and install esptool once:

```powershell
py -m pip install -r requirements.txt
```

On macOS or Linux, use `python3 -m pip install -r requirements.txt` instead.

Connect a XIAO ESP32-C6 over USB-C with external power disconnected. Find its serial port (on Windows, in Device Manager under **Ports (COM & LPT)**), then run:

```powershell
py flash.py COM12
```

Replace `COM12` with your board's port. On macOS or Linux, for example, use `python3 flash.py /dev/ttyACM0` with the actual `/dev/` port. You can also omit the port to choose from a list. The script checks the chip, flash size, security settings, and firmware hash, then asks you to confirm the port before overwriting the board. It checks the complete image during writing and verifies the static flash regions afterward. NVS is excluded from the second check because the running firmware writes settings there. If `py` is unavailable on Windows, use `python`.

Connect only the board you intend to flash. The script stores no hardware identifier and cannot distinguish the original board from another one automatically.

To check a board without writing:

```powershell
py flash.py COM12 --check-only
```

If esptool cannot connect, hold **BOOT**, briefly press **RESET/EN**, release **BOOT**, and run the command again.

**Flashing replaces all 4 MB of the target board's flash.** Disconnect external power and the LED signal wiring before flashing; disconnect USB before the first battery-powered test.

## Change Colors over Bluetooth

1. Power a board flashed with this firmware. Turn on Bluetooth on the phone or computer.
2. Open the controller page in **Chrome on Android** or **Chrome/Edge on a computer**. The page must be served by HTTPS (GitHub Pages) or localhost. Ordinary Safari on iPhone does not support Web Bluetooth.
3. Press **Connect device** and select a nearby **BusyLight-C6** in the browser chooser. If several boards with the same name are nearby, temporarily power only the intended board while connecting.
4. Change the two color pickers. The page reads the board's current colors when it connects and sends new values directly to that board. The page's headphone switch is only a visual preview; the physical microswitch controls the real light.

The BLE service UUID is `7172deda-11a4-42ff-a8a4-aed654cd1902`. The top and front characteristics use text values in `#RRGGBB` format and are readable and writable. Both the firmware and page must use the UUIDs specified in their source files.

The top indicator defaults to red; the front LEDs default to white. The top indicator lights in its selected color when headphones are removed and is off while the microswitch is pressed. The five front LEDs use their selected color in both switch states. Color changes are saved to the device about one second after the last change and restored after restart.

BLE advertising stays on while the device has power and resumes after a browser disconnects. The color characteristics do not require pairing, so anyone nearby with a BLE client can change the colors. Set up BLE authentication in the firmware if that is not acceptable for your use.

## Open the Page on Localhost

From this project folder, run:

```powershell
py -m http.server 8765 --bind 127.0.0.1 --directory site
```

Open **http://127.0.0.1:8765/** on the same computer. The page shows a visual preview when no board is connected. On a supported browser, **Connect device** opens the Bluetooth chooser; after connecting, the color controls send values to the real board. The page uses only static files, so it can also be hosted on GitHub Pages over HTTPS. Put both `index.html` and `app.js` in the published site directory.

## Publish on GitHub Pages

Put this project in a GitHub repository and push it to the repository's default branch. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source. The included workflow checks the browser connection logic before publishing the contents of `site` over HTTPS. Only the page files are uploaded as the Pages artifact; the firmware image and local backups are not part of the website. The workflow also supports a manual run from the **Actions** tab.

The GitHub Pages URL can be shared with anyone using the compatible browsers listed above. Each visitor needs internet access to load the page, then presses **Connect device** and chooses a nearby board with this firmware. Color commands travel over BLE, not over the visitor's internet connection. The website itself contains no per-device ID or password.

## Wiring

The wiring below is for the **Seeed Studio XIAO ESP32-C6**. Its D0, D1, and D2 pins correspond to GPIO0, GPIO1, and GPIO2 ([Seeed pin map](https://wiki.seeedstudio.com/xiao_esp32c6_getting_started/)).

| XIAO pin | GPIO | Connection |
| --- | --- | --- |
| D0 | GPIO0 | Microswitch **NC**. Connect the switch **COM** to GND; leave **NO** unconnected. |
| D1 | GPIO1 | Top WS2812 data: 74AHCT125 channel 1, then a 330 Ω series resistor to the LED's DIN. |
| D2 | GPIO2 | Front pixel data: 74AHCT125 channel 2, then a 330 Ω series resistor to the first pixel's DIN. |
| 5V | — | Boost converter `OUT+` through a 1N5819 diode, striped end toward the XIAO. |
| GND | — | Common ground for the boost converter, LEDs, and 74AHCT125. |
| BAT+ / BAT− | — | Leave unconnected. The battery holder connects to the boost converter input. |

Power and remaining connections:

- Connect the two-AA battery holder's `+` lead to boost converter `IN+`, and its `−` lead to `IN−`.
- Connect boost converter `OUT+` (verified 5 V) to both LED modules' 5 V pads and the 74AHCT125 `VCC`. Connect it to XIAO `5V` only through the diode. Connect `OUT−` to the common GND.
- Tie the active-low **OE** pins of the two used 74AHCT125 channels to GND. Place a 100 nF capacitor between `VCC` and GND near the IC. For unused channels on a bare IC, tie their inputs to GND and **OE** pins to 5 V; leave their outputs unconnected.
- Daisy-chain the five front pixels: each `DOUT` goes to the next `DIN`. All five receive 5 V and GND.

With headphones on the hook, the switch is pressed: the top LED is off and all five front pixels glow in the selected color (white by default). Removing the headphones releases the switch: the top LED turns on in its selected color (red by default), and the front pixels animate in their selected color.

## Test After Flashing

After `flash.py` reports successful verification, disconnect USB, connect the circuit and its battery supply, and check both switch states:

1. Press the microswitch as the headphones would: the top LED should be off and all five front pixels should glow in the selected color.
2. Release the microswitch: the top LED should light in its selected color and the five front pixels should animate in their selected color.
3. Use the browser page to choose different colors for the top and front LEDs. Restart the device and confirm that it remembers them.

Successful flash verification proves that the board contains the built code and static data. On every newly assembled device, also check both switch positions and change both colors through the page.

## Rebuild from Source

The image was compiled with **Arduino ESP32 core 3.3.0**, board `esp32:esp32:XIAO_ESP32C6`, and **Adafruit NeoPixel 1.15.1**. Install [Arduino CLI](https://docs.arduino.cc/arduino-cli/installation), then install the pinned board package and NeoPixel library:

```powershell
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@3.3.0 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install "Adafruit NeoPixel@1.15.1"
```

Build the image:

```powershell
py build.py
```

`build.py` checks that the BLE UUIDs in the sketch and web page match, remaps local user paths during compilation, checks that device-data partitions are blank, writes `firmware_deploy.bin`, and updates its SHA-256 in `flash.py` and this README. If Arduino CLI is not on `PATH`, pass its executable with `--arduino-cli`.

To check the browser connection logic during development, run `node --test tests/site.test.mjs` with Node.js 20 or newer. This test does not require a physical ESP32-C6.

## Privacy and Validation

This image was compiled afresh from the included sketch. Its NVS and SPIFFS partitions are blank. At runtime, NVS stores the selected LED colors and system radio data. Source-path remapping was used during compilation so the Windows account name is not embedded. A static check found no original-board MAC address or user path in the release image. The original device dump and photographs are stored separately and are **not** part of this folder.

On November 12, 2026, the BLE firmware was tested on the original ESP32-C6: a Windows BLE client read and wrote both colors, a second connection succeeded, and the user confirmed that changing a color from the localhost page changed the light. The audited image was then rebuilt, flashed, and verified on the same board. Its prior NVS settings were restored from a separate backup. After the final flash, the user confirmed that the localhost page read the restored top color `#3300FF` and front color `#AC2020` and still changed both lights. Flashing a second physical board and the published GitHub Pages URL have not yet been tested.
