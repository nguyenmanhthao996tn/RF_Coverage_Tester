#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* YOU PROVIDE: AES-128 ECB encrypt of one 16-byte block. in/out may NOT alias. */
extern void aes128_encrypt_block(const uint8_t key[16],
                                 const uint8_t in[16],
                                 uint8_t out[16]);

enum {
    LW_OK            =  0,
    LW_ERR_FPORT     = -1,   /* payload present but FPort not in 1..223 */
    LW_ERR_BUF       = -2,   /* output buffer too small */
    LW_ERR_TOO_LONG  = -3,   /* frame would exceed 255 octets before MIC */
};

static void put_le32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v;         p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}

/* ---------- AES-CMAC (RFC 4493) ---------- */
static void cmac_subkey(const uint8_t in[16], uint8_t out[16]) {
    uint8_t msb = in[0] & 0x80;
    for (int i = 0; i < 15; i++)
        out[i] = (uint8_t)((in[i] << 1) | (in[i + 1] >> 7));
    out[15] = (uint8_t)(in[15] << 1);
    if (msb) out[15] ^= 0x87;
}

static void aes_cmac(const uint8_t key[16], const uint8_t *data, size_t len,
                     uint8_t mac[16]) {
    uint8_t zero[16] = {0}, L[16], k1[16], k2[16], x[16] = {0}, y[16], last[16];

    aes128_encrypt_block(key, zero, L);
    cmac_subkey(L, k1);
    cmac_subkey(k1, k2);

    size_t n = (len + 15) / 16;
    int complete = (len != 0) && (len % 16 == 0);
    if (n == 0) n = 1;

    for (size_t i = 0; i + 1 < n; i++) {
        for (int j = 0; j < 16; j++) y[j] = x[j] ^ data[i * 16 + j];
        aes128_encrypt_block(key, y, x);
    }

    size_t off = (n - 1) * 16;
    size_t rem = len - off;
    if (complete) {
        for (int j = 0; j < 16; j++) last[j] = data[off + j] ^ k1[j];
    } else {
        memset(last, 0, 16);
        if (rem) memcpy(last, data + off, rem);
        last[rem] = 0x80;
        for (int j = 0; j < 16; j++) last[j] ^= k2[j];
    }
    for (int j = 0; j < 16; j++) y[j] = x[j] ^ last[j];
    aes128_encrypt_block(key, y, mac);
}

/* ---------- LoRaWAN uplink builder ----------
 * Returns total frame length (>0) on success, or a negative LW_ERR_*.
 * If payload_len == 0, FPort is omitted (valid frame per spec 4.3).
 */
int lorawan_build_uplink(uint32_t dev_addr,
                         const uint8_t nwk_s_key[16],
                         const uint8_t app_s_key[16],
                         uint32_t fcnt,
                         uint8_t fport,
                         const uint8_t *payload, size_t payload_len,
                         uint8_t *out, size_t out_cap)
{
    const int has_payload = (payload_len > 0);
    if (has_payload && (fport < 1 || fport > 223)) return LW_ERR_FPORT;

    size_t msg_len = 1 + 4 + 1 + 2 + (has_payload ? 1 + payload_len : 0);
    if (msg_len > 255)           return LW_ERR_TOO_LONG;  /* B0 length is 1 octet */
    if (out_cap < msg_len + 4)   return LW_ERR_BUF;

    size_t pos = 0;
    out[pos++] = 0x40;                         /* MHDR: unconfirmed uplink, Major 0 */
    put_le32(&out[pos], dev_addr); pos += 4;   /* DevAddr, little endian */
    out[pos++] = 0x00;                         /* FCtrl */
    out[pos++] = (uint8_t)(fcnt);              /* FCnt low 16 bits, LE */
    out[pos++] = (uint8_t)(fcnt >> 8);

    if (has_payload) {
        out[pos++] = fport;

        /* FRMPayload encryption with AppSKey (FPort > 0) */
        for (size_t i = 0; i < payload_len; i += 16) {
            uint8_t A[16] = {0}, S[16];
            A[0] = 0x01;
            A[5] = 0x00;                       /* Dir = 0 (uplink) */
            put_le32(&A[6], dev_addr);
            put_le32(&A[10], fcnt);            /* full 32-bit counter */
            A[14] = 0x00;
            A[15] = (uint8_t)(i / 16 + 1);     /* block counter starts at 1 */
            aes128_encrypt_block(app_s_key, A, S);

            size_t n = payload_len - i; if (n > 16) n = 16;
            for (size_t j = 0; j < n; j++)
                out[pos + i + j] = payload[i + j] ^ S[j];
        }
        pos += payload_len;
    }

    /* MIC = CMAC(NwkSKey, B0 | msg)[0..3] */
    uint8_t buf[16 + 255];
    buf[0] = 0x49;
    memset(&buf[1], 0, 4);
    buf[5] = 0x00;                             /* Dir = 0 (uplink) */
    put_le32(&buf[6], dev_addr);
    put_le32(&buf[10], fcnt);
    buf[14] = 0x00;
    buf[15] = (uint8_t)msg_len;
    memcpy(&buf[16], out, msg_len);

    uint8_t mac[16];
    aes_cmac(nwk_s_key, buf, 16 + msg_len, mac);
    memcpy(&out[pos], mac, 4);
    pos += 4;

    return (int)pos;
}




// HOW TO USE THE ABOVE FUNCTIONs
uint8_t frame[64];
uint8_t data[] = { 0x01, 0x02, 0x03 };
int n = lorawan_build_uplink(0x26011BDA, nwk_s_key, app_s_key,
                             fcnt, 1, data, sizeof data,
                             frame, sizeof frame);
if (n > 0) { /* send frame[0..n-1] to the radio */ fcnt++; /* persist! */ }