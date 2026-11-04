# RF Coverage Tester

LoRaWAN coverage tester for a smart-building project (TTLab). A battery-powered
RAK11720 (RUI3) sends numbered ABP uplinks from each spot in the building. The
operator walks the building, enters the current location by hand, and starts a
test run from a phone. RSSI/SNR is read at the gateways (ChirpStack, via MQTT).

**Scope of this repo: the tester device firmware and its web control page.**
Two planned additions are now in scope (neither is started; see README Todo):
the floor map of the UIT-E building, and reading results (RSSI/SNR) from the
network server over MQTT. Network server setup itself, analysis and heatmaps
stay elsewhere and are out of scope. `docs/floor_planning_png/` already holds
floor plan images and a grid-overlay prototype page.

## Layout

- `src/rak11720_rui3_firmware/rak11720_rui3_firmware.ino` - Arduino IDE sketch. Pure BLE (Nordic UART) <-> AT command bridge.
- `src/web_control/www/index.html` - single-file Web Bluetooth control page. No build step, no dependencies.
- `src/web_control/docker-compose.yml` - Hosting: BusyBox httpd serving the folder on 127.0.0.1:8080, fronted by `tailscale serve` for HTTPS. Not yet run on the LXC from this repo.
- `docs/uplink_packet_format.txt` - 14-byte test payload. **Source of truth** for the payload.
- `docs/rak_rui3_at_commands.txt` - RUI3 AT command reference (full list, including `AT+BAND` indices). Not an app input; just reference.
- `docs/LoRaWANUplinkBuilder.c` - C reference for the LoRaWAN uplink frame builder. The page's JS builder is a port of it. Reference only (its trailing usage snippet is not compilable).
- `docs/p2p_mode_run_log.md` - log of the unattended run that added P2P mode (decisions, results, what is still unverified). `docs/p2p_bench_checklist.md` - the hardware and network checks that run could not do.
- `tools/stamp_version.mjs` - rewrites the footer Version and Modified date in `index.html`. `.githooks/pre-commit` runs it (see "Version and modified date").
- `src/web_control/test/` - tests, not served by the container: `builder.test.mjs` (Node, frame builder vs golden frames), `page_harness.html` (page vs a fake RAK11720, in a browser over http). See its README.

## Fixed test constraints (do not change)

- Hardware: RAK11720 plus battery. Nothing else.
- ABP only (`AT+NJM=0`), Class A, region **AS923-2** (`AT+BAND=9`), LoRaWAN FPort default 2 (configurable on the page, 1-223).
- ADR off (`AT+ADR=0`) and unconfirmed uplinks (`AT+CFM=0`) are mandatory for a coverage test.
- **Optional P2P mode** (checkbox on the page): the LoRaWAN stack's dwell-time limits make SF11/SF12 unusable and cap SF10 at 10 bytes payload on AS923-2, so the page can instead build the LoRaWAN uplink itself (ABP, unconfirmed, LoRaWAN 1.0.x frame) and send it as raw LoRa with `AT+PSEND`. Still uplink-only and ABP. The frame must stay receivable by the LoRaWAN gateways and ChirpStack: public sync word 3444, LoRaWAN data rates only, preamble 8, CR 4/5, IQ not inverted, a frequency the gateway listens on.
- Uplink only. No downlinks, no other test types planned.
- ABP frame-counter reset is handled on the ChirpStack side, not here.
- Regulatory limits are not a concern. This is a test tool; follow what the RAK11720 can do.

## Architecture

- **Firmware does no test logic.** It names the BLE device, opens an unpaired BLE UART, and passes AT commands through `Serial6` (`RAK_AT_MODE`). Keep it that way.
  - Dev unit BLE name: `TTLab.CoverageTester-001`. Production will be multiple prebuilt binaries that differ only by name, so keep the name a single constant at the top of the sketch.
- **The web page does all the work**: BLE connect (NUS service), AT setup (`runSetup`, or `runSetupP2P` in P2P mode), then send N packets at a fixed interval (`startTest`, `buildPayload`). The user types the location ID manually.
- **P2P mode** (still no firmware logic): `ensureMode()` switches the module with `AT+NWM=0` / `1` (it reboots and drops BLE; the page reconnects). `runSetupP2P()` sets the radio with the long AT names (`AT+RFFREQUENCY`, `AT+SPREADINGFACTOR`, ...), falling back to the older short ones (`PFREQ`, `PSF`, ...) on `AT_ERROR`, and reads each back. The frame comes from `lorawanUplink()` (the `<lorawan-builder>` block in `index.html`, Web Crypto AES) and goes out with `AT+PSEND=<hex>`; `AT+PSEND` answers `OK` at once and `+EVT:TXP2P DONE` when the radio is finished, so the page waits for the event (`armEvent`). The module never sees the ABP keys in P2P mode.
- Config and known BLE devices persist in `localStorage` (this includes ABP keys).

## Build and flash (firmware)

- Arduino IDE. Board Manager URL: `https://raw.githubusercontent.com/RAKWireless/RAKwireless-Arduino-BSP-Index/main/package_rakwireless_com_rui_index.json`
- Install **RAKwireless RUI Apollo3 Boards** (installed version: _not recorded yet - fill in_).
- Board: **RAKWireless RUI APOLLO3 Modules > WisBlock Core RAK11720 Board**. AT UART is 115200 8N1.
- Upload normally. If the module does not enter BOOT mode, send `AT+BOOT`; `AT+RUN` exits it. Unbricking steps are in the RAK quickstart: https://docs.rakwireless.com/product-categories/wisduo/rak11720-module/quickstart/

## Web app

- Web Bluetooth needs a secure context (HTTPS or `localhost`; `file://` will not work, and `http://<tailscale-ip>` is not secure). Hosted on a Proxmox LXC via `src/web_control/docker-compose.yml` plus `tailscale serve --bg 8080` on the host. Deploy: `git pull && docker compose up -d` in `src/web_control`.
- Target: **mobile first**, Chrome on Android primary, Windows Chrome secondary. iOS is not supported by Web Bluetooth.
- Keep it a single dependency-free `index.html`. No frameworks or build tooling for now.
- Page structure: a run card at the top (Location ID, Start/Stop, progress, status line) and collapsible settings sections below (Connection, Device keys, LoRa parameters, Test setup, Device, Debug). Each of the first four settings sections has its own Save button that validates, stores and collapses it; Start refuses to run while a section is unsaved. The Device section has no Save (see below). The Debug section (raw AT, log, Save log) is collapsed by default.
- LoRa parameters section: Region, FPort and TX power sit above two tabs, `By Datarate` (list of LoRaWAN Regional Parameters DR0-DR6) and `Manual` (SF/BW/CR). The tabs edit the same sf/bw values; the saved state is sf/bw, and switching tabs does not mark the section unsaved. FPort is not part of the setup signature (it only goes into `AT+SEND`), and a stored config without it keeps the default 2.
- Log lines carry a `HH:MM:SS.mmm` timestamp; Save log writes a `.txt` with full date and time per line. Any 32-hex token (ABP keys) is masked as `<key hidden>` in the log and the file.
- DevEUI is not used: ABP uplinks never carry it, so the page neither asks for it nor sends `AT+DEVEUI` (unverified on a real unit; the module keeps its factory DevEUI).
- `runSetup()` / `runSetupP2P()` run only on the first Start of a connection or when the setup signature changed (or after a raw AT command), not before every run. The signature is keys/region/DR/TX power in LoRaWAN mode and frequency/SF/BW/dBm in P2P mode, so switching mode always re-runs setup.
- P2P mode inputs (LoRa parameters section, all saved with it and optional in stored configs): checkbox `p2p`, `freq` (MHz, 150-960, sent as integer Hz), `fcnt` (Starting FCnt, 0-4294967295). With P2P on, Region is disabled and Frequency/FCnt are enabled; off, the reverse. TX power is a whole 5-22 dBm sent as typed (no `AT+TXP` index, so the unverified mapping does not apply). Data rate is still picked from `RP_DR`/`DR_TABLE` (LoRaWAN data rates only, so ChirpStack accepts the frame). Packet n of a run uses FCnt `start + n`; after a run (also Stop, error, disconnect) the box and the stored config hold `start + packets sent`. Start refuses an interval shorter than airtime + 250 ms (`loraAirtimeMs`, 27-byte frame) and a run that would pass FCnt 2^32-1.
- Use a ChirpStack device profile with a LoRaWAN **1.0.x** MAC version: the MIC built here is the 1.0.x one. Mixing LoRaWAN-mode and P2P-mode uplinks on one DevAddr makes the FCnt jump; prefer a separate ChirpStack device for P2P, or reset the counter on ChirpStack.
- Per-spot inputs sit outside the saved sections. Location ID is deliberately not persisted. Floor level (0-255, stepper, payload byte 13) is persisted, starts empty, and Start requires it.
- Device section (`resetDevice`): one **Reset** button, which sends `ATR` after a confirm and expects the module to drop BLE, reconnects the same device (retries for 25 s, `AT` probe), then verifies with `AT+NWM=?` (0 or 1 are both fine: the message says which mode the module is in and whether the next Start will switch it to the mode selected on the page). A getter replies `AT+NWM=1` then `OK` (verified on RUI_4.3.0_RAK11720), parsed by `getterValue()`, which `ensureMode()` and the P2P read-backs also use. Reset sets `setupSig = null`, so the next Start re-runs the setup. It is disabled while a run or another reset is going (`busy`). It has only been tested against an in-browser fake module (boot banner, timeouts, reboot with and without `OK`, no reboot, failed reconnect, NWM=0), not a real unit.
- Connection: known devices first, then a name/prefix box, one Scan button (empty box = list all devices, otherwise a `namePrefix` filter), then Disconnect. The box value is remembered.

## Version and modified date

- The page footer shows `Version x.y.z`, `Modified YYYY-MM-DD`, author `nguyenmanhthao996tn` and `TTLab Research Group, FCE, UIT`. Version and date live only in `<span id="appVersion">` and `<span id="appModified">` in `index.html`; that file is the single source of truth.
- **Never edit those two spans by hand to "update" them.** `tools/stamp_version.mjs` does it. The pre-commit hook (`.githooks/pre-commit`) runs `node tools/stamp_version.mjs --auto` whenever `index.html` is in a commit: if the page differs from HEAD (ignoring the stamp) it bumps the patch number and sets the date to today (local), then stages the file.
- Enable the hook once per clone: `git config core.hooksPath .githooks` (git does not carry hook config in a clone). Needs Node, which the tests already need.
- Bigger bumps: before committing run `node tools/stamp_version.mjs --bump=minor` (or `--bump=major`, or `--set=x.y.z` for an exact number) and stage the file; the hook keeps a version that already differs from HEAD and only refreshes the date. Use minor for a new user-visible feature, major for a payload or setup change that breaks comparability with earlier runs.
- **When committing for the user: if `git config core.hooksPath` is not `.githooks`, run `node tools/stamp_version.mjs --auto` and `git add` the page before `git commit`.** Never use `--no-verify`. If the hook refuses because `index.html` has unstaged changes, stage the whole file instead of bypassing it.
- Changing `index.html` without committing does not change the stamp; that is expected.
- **Commit id**: the footer shows `Version x.y.z (abc1234)`. The id cannot be stored in the committed `index.html` (it is a hash of that content), so `.githooks/write_commit_id.sh` writes the short `HEAD` id to `src/web_control/www/commit.txt` (git-ignored) from the `post-commit`, `post-merge` and `post-checkout` hooks, and the page fetches it at load. No `commit.txt` (hooks not enabled, `file://`) means nothing is shown. On the LXC, enable the hooks once (`git config core.hooksPath .githooks`, then `sh .githooks/write_commit_id.sh` for the current checkout); after that `git pull` keeps it current and the bind-mounted folder serves it without a container restart. The id is `HEAD` at the last hook run, so uncommitted edits are not reflected. Do not commit `commit.txt` or hard-code an id in the page.

## Conventions

- **Payload changes**: update `buildPayload()` and `docs/uplink_packet_format.txt` in the same commit.
- **Secrets**: never commit real DevAddr, NwkSKey or AppSKey. Use obvious dummy values in code, docs and examples. Never hardcode keys in source.
- **TX power**: the user-facing value, the displayed value and payload byte 2 are all **dBm** (signed 8-bit). In LoRaWAN mode the web page converts to the `AT+TXP` index internally; in P2P mode the dBm goes straight to `AT+TXOUTPUTPOWER` (5-22).
- Keep the firmware a pure AT bridge. Test logic, retries and sequencing belong in the web page.
- Branch: `main`. Small, focused commits.
- Treat anything not confirmed against RAK docs or a real unit as unverified; say so in comments and docs.

## Known issues / TODO

- **TX power**: implemented. The page takes dBm in a number box, snaps to the nearest step of `TXP_DBM` (16 to 2 dBm; a tie goes to the higher power, out-of-range values clamp), shows the snapped value and the `AT+TXP` index, and sends the snapped dBm in payload byte 2. It rests on the unverified mapping below.
- **Index to dBm mapping is unverified**: `AT+TXP` on AS923 is 0-7 (0 = highest). Assumed mapping is `dBm = 16 - 2 * index` (16, 14, ... 2). RAK's AT manual defers to a regional-parameters appendix. Confirm via the appendix or by measuring a unit. The LoRaWAN stack caps power below the SX1262's +22 dBm, so `AT+TXP` cannot reach the radio's full range.
- **Data rate list likely too wide**: RAK's manual says `AT+DR` on AS923 accepts DR2-DR5 only (SF10-SF7 at 125 kHz). `RP_DR` (the By Datarate list, also behind `DR_TABLE`) also offers SF11/SF12 (DR0/DR1) and SF7/250 kHz (DR6), which may fail with `AT_PARAM_ERROR`. Test on a unit, then trim `RP_DR` and the SF/BW options, and update the payload doc if the SF range changes. The `RP_DR` values are from memory of the Regional Parameters, not checked against the spec text. P2P mode does not use `AT+DR`, so SF11/SF12/DR6 are expected to work there (not tried on a unit).
- **ATR unverified on a real unit**: what `ATR` resets (LoRaWAN params only, or also AT baud/LPM/NWM), whether it reboots the MCU (and so drops BLE), how long until the module advertises again (the page waits up to 25 s), and whether Android Chrome reconnects the same `BluetoothDevice` without a new scan. Record the observed values here after the first Reset on a unit. Seen on a real unit (RUI_4.3.0_RAK11720): a getter answers `AT+NWM=1` then `OK`, and a reply can lose bytes over BLE (`AT+SN=AC1F09F` cut short, no `OK`, next reply glued on); if that keeps happening, look at the firmware's BLE TX buffering in the sketch.
- **Mobile layout**: restructured (sections, large Start/Stop, status line, wake lock, vibration) but only checked in a desktop-emulated phone viewport. Wake lock, vibration and the BLE flow are untested on a real Android phone.
- **ABP keys in `localStorage`**: stored in plain text in the browser. Acceptable for dev; revisit for production.
- **RUI3 BSP version**: not recorded (see Build and flash).
- **P2P mode is untested on a real unit and a real network.** Only the frame builder (golden frames from a Python port of the C reference, RFC 4493, FIPS-197) and the page logic (fake module) are tested. Unverified, in the order they can sink the feature: (1) whether the module's P2P frames are received by the gateway at all, which needs CRC on, an explicit header and non-inverted IQ (there is no AT command for CRC or header); (2) `AT+SYNCWORD=3444` taking effect and its read-back format; (3) whether the long names (`AT+RFFREQUENCY`, ...) exist on RUI_4.3.0 or only the short ones; (4) `AT+PSEND` / `+EVT:TXP2P DONE` timing and whether `AT+PSEND` needs `AT+PRECV=0` first; (5) the reboot and reconnect time of `AT+NWM`, and whether the mode survives a power cycle; (6) ChirpStack accepting the MIC and the counter. The step-by-step checks are in `docs/p2p_bench_checklist.md`.
- **P2P channel plan**: the frequency is typed by hand and not checked against any channel plan. A frequency the gateway does not listen on fails silently. For AS923-2 the LoRaWAN default channels are, to the best of my memory (not checked against the spec), 921.4 and 921.6 MHz.
- **FCnt at 2^32-1**: after a run that ends exactly on the last counter value the FCnt box keeps the last used number (the next one does not exist). Irrelevant in practice.
- **Uncommitted**: the P2P work (page, tests, docs, `docs/LoRaWANUplinkBuilder.c`) was left in the working tree by the unattended run.
