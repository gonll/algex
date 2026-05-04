#include "gf256.h"

/* Log/exp tables for GF(2^8) under the AES polynomial.
   EXP is doubled so that EXP[LOG[a] + LOG[b]] never needs modulo. */
static uint8_t LOG_TBL[256];
static uint8_t EXP_TBL[512];
static int     ready = 0;

void gf256_init(void)
{
    if (ready) return;

    uint8_t x = 1;
    for (int i = 0; i < 255; i++) {
        EXP_TBL[i] = x;
        LOG_TBL[x] = (uint8_t)i;
        /* multiply by primitive element α = 3 = (x+1) in GF(2^8) */
        x ^= (uint8_t)((x << 1) ^ (x & 0x80 ? 0x1b : 0));
    }
    for (int i = 255; i < 512; i++) EXP_TBL[i] = EXP_TBL[i - 255];
    LOG_TBL[0] = 0;  /* LOG[0] is undefined; set to 0 as sentinel */
    ready = 1;
}

uint8_t gf_mul(uint8_t a, uint8_t b)
{
    if (!a || !b) return 0;
    return EXP_TBL[LOG_TBL[a] + LOG_TBL[b]];
}

uint8_t gf_inv(uint8_t a)
{
    if (!a) return 0;
    return EXP_TBL[255 - LOG_TBL[a]];
}

uint8_t gf_div(uint8_t a, uint8_t b)
{
    return gf_mul(a, gf_inv(b));
}

int gf_order(uint8_t a)
{
    if (!a) return 0;
    if (a == 1) return 1;
    uint8_t x = a;
    for (int k = 1; k < 255; k++) {
        x = gf_mul(x, a);
        if (x == 1) return k + 1;
    }
    return 255;
}
