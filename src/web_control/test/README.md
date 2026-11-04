# Tests for the web control page

Nothing here is served by the container (`docker-compose.yml` mounts only `www/`).

## Frame builder (Node 20+, no packages)

```bash
node builder.test.mjs
```

Extracts the `<lorawan-builder>` block from `../www/index.html` and checks it against FIPS-197, the RFC 4493
CMAC examples and 225 golden frames in `vectors.json`. Regenerate the frames with
`python -I ref_vectors.py > vectors.json` (needs the `cryptography` package). `ref_vectors.py` is a literal
Python port of `docs/LoRaWANUplinkBuilder.c`; its MIC is cross-checked against the library's CMAC.
The C file itself has never been compiled here (no C compiler on the dev machine).

## Page against a fake RAK11720 (any Chromium browser, over http)

```bash
cd src/web_control
python -m http.server 8099
```

Open `http://localhost:8099/test/page_harness.html` and keep the tab visible. When it ends the title reads
`DONE <n> passed <m> failed`, with every check listed on the page. The fake module is written from RAK's AT
manual, so it proves the page logic, not the real module's behaviour. Time inside the page runs 10x faster.
The harness stores its test configs in the `localStorage` of `localhost:8099`.
