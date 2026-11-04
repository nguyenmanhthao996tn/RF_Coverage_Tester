# RF Coverage Tester

A LoRaWAN coverage tester for a smart-building project. A battery-powered **RAK11720** sends numbered uplinks from
each spot in the building, and you control it from a web page in Chrome over Bluetooth.

## How it works

1. Walk to a spot and type its location ID (and the floor) into the web page.
2. Press **Start**. The page connects to the RAK11720 over BLE and sends N uplinks at a fixed interval.
3. The gateways record RSSI/SNR for each numbered packet on the network server (ChirpStack).

The device firmware is a plain BLE-to-AT-command bridge. All test logic lives in the web page.

```
 phone / PC (Chrome)  --BLE-->  RAK11720  --LoRa-->  gateways  -->  ChirpStack
   web control page          (AT bridge)
```

Fixed test settings: ABP, Class A, region AS923-2, uplink only, ADR off, unconfirmed uplinks. An optional **P2P
mode** builds the LoRaWAN frame in the page and sends it as raw LoRa, which allows SF11/SF12.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/rak11720_rui3_firmware/` | Arduino sketch for the RAK11720 (BLE UART to AT commands) |
| `src/web_control/www/index.html` | The control page: one file, no build step, no dependencies |
| `src/web_control/docker-compose.yml` | Serves the page locally |
| `src/web_control/test/` | Tests for the frame builder and the page (see its README) |
| `docs/uplink_packet_format.txt` | The 14-byte test payload (source of truth) |
| `docs/rak_rui3_at_commands.txt` | RUI3 AT command reference |

## Setup: RAK11720 hardware

You need a RAK11720 with a battery and the Arduino IDE.

1. In the Arduino IDE, add this Board Manager URL (File > Preferences):
   `https://raw.githubusercontent.com/RAKWireless/RAKwireless-Arduino-BSP-Index/main/package_rakwireless_com_rui_index.json`
2. Install **RAKwireless RUI Apollo3 Boards** in the Boards Manager.
3. Select **RAKWireless RUI APOLLO3 Modules > WisBlock Core RAK11720 Board**.
4. Open `src/rak11720_rui3_firmware/rak11720_rui3_firmware.ino`. Set a unique BLE name in `dev_name`
   (default `TTLab.CoverageTester-001`); each unit needs its own.
5. Upload.

If the module does not enter BOOT mode, send `AT+BOOT` (115200 8N1) and try again; `AT+RUN` exits BOOT mode. For
unbricking, see the
[RAK11720 quickstart](https://docs.rakwireless.com/product-categories/wisduo/rak11720-module/quickstart/).

Afterwards the device shows up in a Bluetooth scan under the name you set. The device keys are not stored on the
module by the firmware; you enter them in the web page.

## Setup: web page (local)

Web Bluetooth only works in a secure context. `http://localhost` counts as one, so no HTTPS is needed, but opening
the file directly (`file://`) does not work. Use Chrome (Android or Windows); iOS does not support Web Bluetooth.

**With Docker:**

```bash
cd src/web_control
docker compose up -d
```

Then open <http://localhost:8080>. The container binds to `127.0.0.1:8080` only. To update, run `git pull`; the
folder is mounted read-only, so there is nothing to rebuild.

**Without Docker:** serve the `www` folder with any static file server, for example:

```bash
python -m http.server 8080 --bind 127.0.0.1 --directory src/web_control/www
```

**Using it from a phone:** an Android phone cannot reach `localhost` on your PC by itself. One option is USB
debugging with `adb reverse tcp:8080 tcp:8080`, then opening `http://localhost:8080` on the phone. This is not
tested here.

### First run

1. Open **Connection**, scan for your device (leave the name box empty to list all, or type a prefix such as
   `TTLab`), connect, and Save.
2. In **Device keys**, enter the ABP DevAddr, NwkSKey and AppSKey registered on ChirpStack. Never commit real keys
   to the repository. Keys are stored in the browser's `localStorage` in plain text.
3. Set **LoRa parameters** (region, FPort, TX power, data rate) and **Test setup** (number of packets and
   interval), and Save each section.
4. Enter the **Floor** and **Location ID** for the current spot, then press **Start**.

Tip for P2P mode: use a ChirpStack device profile with LoRaWAN **1.0.x**, and prefer a separate ChirpStack device
for P2P uplinks so the frame counter does not jump.

### Tests

```bash
node src/web_control/test/builder.test.mjs
```

This checks the frame builder only (Node 20+). The page-level harness is described in
[`src/web_control/test/README.md`](src/web_control/test/README.md).

## Todo

- [ ] Add the floor map of the UIT-E building.
- [ ] Read the results (RSSI/SNR) from the network server over MQTT.

Not yet verified on real hardware:

- [ ] P2P mode on a real unit and network (gateway reception, sync word, `AT+PSEND` timing, ChirpStack MIC and counter).
- [ ] The `AT+TXP` index-to-dBm mapping, and the data rate list (SF11/SF12/DR6 may be rejected in LoRaWAN mode).
- [ ] `ATR` reset behaviour and BLE reconnect timing.
- [ ] The page on a real Android phone (wake lock, vibration, BLE).

---

TTLab Research Group, FCE, UIT. Author: nguyenmanhthao996tn.
