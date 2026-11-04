// Checks the LoRaWAN frame builder that lives inside www/index.html (between the <lorawan-builder> markers).
// Run:  node builder.test.mjs      (Node 20+, no packages)
// Reference frames come from ref_vectors.py (literal port of docs/LoRaWANUplinkBuilder.c).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'www', 'index.html'), 'utf8');
const m = html.match(/\/\/ <lorawan-builder>[\s\S]*?\/\/ <\/lorawan-builder>/);
if (!m) { console.error('FAIL: <lorawan-builder> block not found in index.html'); process.exit(1); }

const isHex = (s, n) => new RegExp(`^[0-9a-fA-F]{${n}}$`).test(s);   // same helper the page defines
const B = new Function('isHex', 'crypto', `${m[0]}\nreturn { aesBlock, aesCmac, lorawanUplink, loraAirtimeMs, hexBytes, bytesHex };`)(isHex, globalThis.crypto);

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); } };
const eq = (a, b, name) => ok(a === b, name, `\n  got      ${a}\n  expected ${b}`);

// A1: FIPS-197 appendix C.1
eq(B.bytesHex(await B.aesBlock('000102030405060708090A0B0C0D0E0F', B.hexBytes('00112233445566778899AABBCCDDEEFF'))),
   '69C4E0D86A7B0430D8CDB78070B4C55A', 'A1 FIPS-197 AES-128');

// A2: RFC 4493 section 4 examples
const K = '2B7E151628AED2A6ABF7158809CF4F3C';
const M = B.hexBytes('6BC1BEE22E409F96E93D7E117393172AAE2D8A571E03AC9C9EB76FAC45AF8E5130C81C46A35CE411E5FBC1191A0A52EFF69F2445DF4F9B17AD2B417BE66C3710');
for (const [len, mac] of [[0, 'BB1D6929E95937287FA37D129B756746'], [16, '070A16B46B4D4144F79BDD9DD04A287C'],
                          [40, 'DFA66747DE9AE63030CA32611497C827'], [64, '51F0BEBF7E3B9D92FC49741779363CFE']])
  eq(B.bytesHex(await B.aesCmac(K, M.subarray(0, len))), mac, `A2 CMAC RFC 4493 len ${len}`);

// A3: golden frames from the C-port reference
const v = JSON.parse(readFileSync(join(here, 'vectors.json'), 'utf8'));
for (const c of v.cases) {
  const frame = await B.lorawanUplink({ devAddr: v.devAddr, nwkSKey: v.nwkSKey, appSKey: v.appSKey, fcnt: c.fcnt, fport: c.fport, payload: B.hexBytes(c.payload) });
  eq(B.bytesHex(frame), c.frame, `A3 fcnt=${c.fcnt} fport=${c.fport} len=${c.payload.length / 2}`);
}

// A5: the on-air counter wraps at 16 bits, but the MIC and keystream use all 32 bits
const base = { devAddr: v.devAddr, nwkSKey: v.nwkSKey, appSKey: v.appSKey, fport: 2, payload: B.hexBytes('00112233445566778899AABBCCDD') };
const f65535 = await B.lorawanUplink({ ...base, fcnt: 65535 });
const f65536 = await B.lorawanUplink({ ...base, fcnt: 65536 });
eq(B.bytesHex(f65535.subarray(6, 8)), 'FFFF', 'A5 FCnt 65535 on air');
eq(B.bytesHex(f65536.subarray(6, 8)), '0000', 'A5 FCnt 65536 wraps on air');
ok(B.bytesHex(f65536) !== B.bytesHex(await B.lorawanUplink({ ...base, fcnt: 0 })), 'A5 FCnt 65536 differs from 0 (MIC/keystream use 32 bits)');

// A6: shape and limits
eq(f65535.length, 27, 'A6 14-byte payload gives a 27-byte frame');
eq(f65535[0], 0x40, 'A6 MHDR is unconfirmed uplink');
eq(f65535[5], 0x00, 'A6 FCtrl is 0 (ADR off)');
eq(B.bytesHex(f65535.subarray(1, 5)), 'DA1B0126', 'A7 DevAddr is little-endian on air');
eq((await B.lorawanUplink({ ...base, fcnt: 0, payload: new Uint8Array(0) })).length, 12, 'A6 empty payload: no FPort, 12-byte frame');
const bad = async (over, name) => { try { await B.lorawanUplink({ ...base, fcnt: 0, ...over }); ok(false, name); } catch { ok(true, name); } };
await bad({ fport: 0 }, 'A6 FPort 0 rejected');
await bad({ fport: 224 }, 'A6 FPort 224 rejected');
await bad({ fcnt: -1 }, 'A6 FCnt -1 rejected');
await bad({ fcnt: 4294967296 }, 'A6 FCnt 2^32 rejected');
await bad({ fcnt: 1.5 }, 'A6 FCnt 1.5 rejected');
await bad({ devAddr: '123' }, 'A6 short DevAddr rejected');
await bad({ nwkSKey: 'zz'.repeat(16) }, 'A6 non-hex key rejected');
await bad({ payload: new Uint8Array(250) }, 'A6 oversize frame rejected');

// Airtime (Semtech formula worked by hand), 27-byte frame, CR 4/5, 125 kHz, preamble 8, CRC on, explicit header
const near = (a, b, tol, name) => ok(Math.abs(a - b) <= tol, name, `got ${a} expected ${b}`);
near(B.loraAirtimeMs(12, 125, 27), 1646.6, 0.5, 'airtime SF12/125');
near(B.loraAirtimeMs(11, 125, 27), 823.3, 0.5, 'airtime SF11/125');
near(B.loraAirtimeMs(7, 125, 27), 66.8, 0.5, 'airtime SF7/125');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
