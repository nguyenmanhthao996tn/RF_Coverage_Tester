"""Reference frames for builder.test.mjs.

No C compiler was available when this was written, so this is a literal Python port of
docs/LoRaWANUplinkBuilder.c (same CMAC, same block layout), with AES taken from the `cryptography` package.
The MIC is also cross-checked against the package's own CMAC, so the port and the library must agree.

Run:  python -I ref_vectors.py > vectors.json
"""
import json
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.cmac import CMAC

# Obvious dummy values, never real keys.
DEV_ADDR = 0x26011BDA
NWK = bytes.fromhex("00112233445566778899AABBCCDDEEFF")
APP = bytes.fromhex("FFEEDDCCBBAA99887766554433221100")


def aes_block(key, block):
    e = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return e.update(bytes(block)) + e.finalize()


def le32(v):
    return (v & 0xFFFFFFFF).to_bytes(4, "little")


def subkey(b):
    v = int.from_bytes(b, "big") << 1
    out = (v & ((1 << 128) - 1)).to_bytes(16, "big")
    if b[0] & 0x80:
        out = out[:15] + bytes([out[15] ^ 0x87])
    return out


def cmac_c_port(key, data):
    L = aes_block(key, bytes(16))
    k1 = subkey(L)
    k2 = subkey(k1)
    n = (len(data) + 15) // 16
    complete = len(data) != 0 and len(data) % 16 == 0
    if n == 0:
        n = 1
    x = bytes(16)
    for i in range(n - 1):
        y = bytes(a ^ b for a, b in zip(x, data[i * 16:i * 16 + 16]))
        x = aes_block(key, y)
    off = (n - 1) * 16
    rem = len(data) - off
    if complete:
        last = bytes(data[off + j] ^ k1[j] for j in range(16))
    else:
        last = bytearray(16)
        last[:rem] = data[off:off + rem]
        last[rem] = 0x80
        last = bytes(a ^ b for a, b in zip(last, k2))
    return aes_block(key, bytes(a ^ b for a, b in zip(x, last)))


def build(dev_addr, nwk, app, fcnt, fport, payload):
    has = len(payload) > 0
    msg_len = 1 + 4 + 1 + 2 + (1 + len(payload) if has else 0)
    out = bytearray()
    out.append(0x40)
    out += le32(dev_addr)
    out.append(0x00)
    out += bytes([fcnt & 0xFF, (fcnt >> 8) & 0xFF])
    if has:
        out.append(fport)
        enc = bytearray()
        for i in range(0, len(payload), 16):
            A = bytearray(16)
            A[0] = 0x01
            A[6:10] = le32(dev_addr)
            A[10:14] = le32(fcnt)
            A[15] = i // 16 + 1
            S = aes_block(app, A)
            for j in range(min(16, len(payload) - i)):
                enc.append(payload[i + j] ^ S[j])
        out += enc
    assert len(out) == msg_len
    b = bytearray(16)
    b[0] = 0x49
    b[6:10] = le32(dev_addr)
    b[10:14] = le32(fcnt)
    b[15] = msg_len
    b += out
    mac = cmac_c_port(nwk, bytes(b))
    c = CMAC(algorithms.AES(nwk))
    c.update(bytes(b))
    assert c.finalize() == mac, "C-port CMAC disagrees with the cryptography library"
    return bytes(out) + mac[:4]


cases = []
for fcnt in (0, 1, 255, 256, 65535, 65536, 65537, 0x12345678, 0xFFFFFFFF):
    for plen in (0, 1, 14, 15, 16, 17, 32, 33, 100):
        for fport in (1, 2, 223):
            if plen == 0 and fport != 2:
                continue
            payload = bytes((i * 7 + 3) & 0xFF for i in range(plen))
            cases.append({
                "fcnt": fcnt, "fport": fport, "payload": payload.hex().upper(),
                "frame": build(DEV_ADDR, NWK, APP, fcnt, fport, payload).hex().upper(),
            })

print(json.dumps({
    "devAddr": "%08X" % DEV_ADDR, "nwkSKey": NWK.hex().upper(), "appSKey": APP.hex().upper(),
    "cases": cases,
}, indent=0))
