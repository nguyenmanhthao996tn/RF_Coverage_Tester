# RF Coverage Tester

LoRaWAN coverage tester for a smart-building project (TTLab). A battery-powered
RAK11720 (RUI3) sends numbered ABP uplinks from each spot in the building. The
operator walks the building, enters the current location by hand, and starts a
test run from a phone. RSSI/SNR is read at the gateways (ChirpStack, via MQTT).

**Scope of this repo: the tester device firmware and its web control page only.**
Network server setup, MQTT collection, analysis, heatmaps and floor plans live
elsewhere and are out of scope.

## Layout

- `src/rak11720_rui3_firmware/rak11720_rui3_firmware.ino` - Arduino IDE sketch. Pure BLE (Nordic UART) <-> AT command bridge.
- `src/web_control/index.html` - single-file Web Bluetooth control page. No build step, no dependencies.
- `docs/uplink_packet_format.txt` - 13-byte test payload. **Source of truth** for the payload.
- `docs/rak_rui3_at_commands.txt` - RUI3 AT command reference (full list, including `AT+BAND` indices). Not an app input; just reference.

## Fixed test constraints (do not change)

- Hardware: RAK11720 plus battery. Nothing else.
- ABP only (`AT+NJM=0`), Class A, region **AS923-2** (`AT+BAND=9`), LoRaWAN port 2.
- ADR off (`AT+ADR=0`) and unconfirmed uplinks (`AT+CFM=0`) are mandatory for a coverage test.
- Uplink only. No downlinks, no other test types planned.
- ABP frame-counter reset is handled on the ChirpStack side, not here.
- Regulatory limits are not a concern. This is a test tool; follow what the RAK11720 can do.

## Architecture

- **Firmware does no test logic.** It names the BLE device, opens an unpaired BLE UART, and passes AT commands through `Serial6` (`RAK_AT_MODE`). Keep it that way.
  - Dev unit BLE name: `TTLab.CoverageTester-001`. Production will be multiple prebuilt binaries that differ only by name, so keep the name a single constant at the top of the sketch.
- **The web page does all the work**: BLE connect (NUS service), AT setup (`runSetup`), then send N packets at a fixed interval (`startTest`, `buildPayload`). The user types the location ID manually.
- Config and known BLE devices persist in `localStorage` (this includes ABP keys).

## Build and flash (firmware)

- Arduino IDE. Board Manager URL: `https://raw.githubusercontent.com/RAKWireless/RAKwireless-Arduino-BSP-Index/main/package_rakwireless_com_rui_index.json`
- Install **RAKwireless RUI Apollo3 Boards** (installed version: _not recorded yet - fill in_).
- Board: **RAKWireless RUI APOLLO3 Modules > WisBlock Core RAK11720 Board**. AT UART is 115200 8N1.
- Upload normally. If the module does not enter BOOT mode, send `AT+BOOT`; `AT+RUN` exits it. Unbricking steps are in the RAK quickstart: https://docs.rakwireless.com/product-categories/wisduo/rak11720-module/quickstart/

## Web app

- Run locally for now (Web Bluetooth needs HTTPS or `localhost`; `file://` will not work). Hosting is undecided.
- Target: **mobile first**, Chrome on Android primary, Windows Chrome secondary. iOS is not supported by Web Bluetooth.
- Keep it a single dependency-free `index.html`. No frameworks or build tooling for now.
- The current page is a demo. Mobile optimization is the goal, not the current state.

## Conventions

- **Payload changes**: update `buildPayload()` and `docs/uplink_packet_format.txt` in the same commit.
- **Secrets**: never commit real DevEUI, DevAddr, NwkSKey or AppSKey. Use obvious dummy values in code, docs and examples. Never hardcode keys in source.
- **TX power**: the user-facing value, the displayed value and payload byte 2 are all **dBm** (signed 8-bit). The web page converts to the `AT+TXP` index internally.
- Keep the firmware a pure AT bridge. Test logic, retries and sequencing belong in the web page.
- Branch: `main`. Small, focused commits.
- Treat anything not confirmed against RAK docs or a real unit as unverified; say so in comments and docs.

## Known issues / TODO

- **TX power (not implemented yet)**: `index.html` still uses a dropdown of `AT+TXP` indices and writes the index into payload byte 2. Target: a text box taking dBm, snapped to the nearest valid step, with the snapped value shown and sent in the payload.
- **Index to dBm mapping is unverified**: `AT+TXP` on AS923 is 0-7 (0 = highest). Assumed mapping is `dBm = 16 - 2 * index` (16, 14, ... 2). RAK's AT manual defers to a regional-parameters appendix. Confirm via the appendix or by measuring a unit. The LoRaWAN stack caps power below the SX1262's +22 dBm, so `AT+TXP` cannot reach the radio's full range.
- **Data rate list likely too wide**: RAK's manual says `AT+DR` on AS923 accepts DR2-DR5 only (SF10-SF7 at 125 kHz). `DR_TABLE` also offers SF11/SF12 (DR0/DR1) and SF7/250 kHz (DR6), which may fail with `AT_PARAM_ERROR`. Test on a unit, then restrict the SF/BW options, and update the payload doc if the SF range changes.
- **Mobile layout**: desktop-sized controls, one long page, no step flow, no screen wake lock during a run.
- **ABP keys in `localStorage`**: stored in plain text in the browser. Acceptable for dev; revisit for production.
- **RUI3 BSP version**: not recorded (see Build and flash).
- **Uncommitted**: `docs/rak_rui3_at_commands.txt` was updated locally and may still need committing.
