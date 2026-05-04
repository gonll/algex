#include "gf_wide.h"
#include <stddef.h>

/* GF(2^16) with primitive polynomial x^16+x^5+x^3+x^2+1.
   α=2 is primitive; 65535 = 2^16-1 entries in each table.
   Tables are file-scope to avoid 128KB on the stack.       */

#define GF16_POLY  0x1002Du   /* reduction polynomial */
#define GF16_ORD   65535u     /* multiplicative group order */

static uint16_t exp_tbl[65535];
static uint16_t log_tbl[65536];  /* index 0 unused (log undefined) */
static int      ready = 0;

void gf16_init(void)
{
    if (ready) return;

    uint32_t x = 1;
    for (uint32_t i = 0; i < GF16_ORD; i++) {
        exp_tbl[i]  = (uint16_t)x;
        log_tbl[x]  = (uint16_t)i;
        /* multiply by α=2: left-shift + reduce if bit 16 set */
        x <<= 1;
        if (x & 0x10000u) x ^= GF16_POLY;
    }
    log_tbl[0] = 0;  /* sentinel; log(0) is undefined */
    ready = 1;
}

uint16_t gf16_mul(uint16_t a, uint16_t b)
{
    if (!a || !b) return 0;
    uint32_t s = (uint32_t)log_tbl[a] + (uint32_t)log_tbl[b];
    if (s >= GF16_ORD) s -= GF16_ORD;
    return exp_tbl[s];
}

uint16_t gf16_inv(uint16_t a)
{
    if (!a) return 0;
    return exp_tbl[GF16_ORD - log_tbl[a]];
}

uint16_t gf16_div(uint16_t a, uint16_t b)
{
    return gf16_mul(a, gf16_inv(b));
}
