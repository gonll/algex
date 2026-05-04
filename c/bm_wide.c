#include "bm_wide.h"
#include "gf_wide.h"
#include <string.h>
#include <stdlib.h>

int bm16_solve(const uint16_t *seq, int n, LFSR16 *out)
{
    memset(out, 0, sizeof(*out));
    if (n <= 0) return 0;

    /* BM is O(n^2); cap to keep runtime bounded */
    if (n > 4096) n = 4096;

    uint16_t *C = (uint16_t *)calloc((size_t)(n + 2), sizeof(uint16_t));
    uint16_t *B = (uint16_t *)calloc((size_t)(n + 2), sizeof(uint16_t));
    uint16_t *T = (uint16_t *)calloc((size_t)(n + 2), sizeof(uint16_t));
    if (!C || !B || !T) {
        free(C); free(B); free(T);
        out->length = n;
        return n;
    }

    C[0] = 1; B[0] = 1;
    int clen = 1, blen = 1;
    int L = 0, m = 1;
    uint16_t b = 1;

    for (int i = 0; i < n; i++) {
        uint16_t d = seq[i];
        for (int j = 1; j <= L; j++)
            d ^= gf16_mul(C[j], seq[i - j]);

        if (!d) { m++; continue; }

        memcpy(T, C, (size_t)(n + 2) * sizeof(uint16_t));
        int tlen = clen;

        uint16_t factor = gf16_div(d, b);
        int needed = blen + m;
        if (needed > clen) clen = needed;
        for (int j = 0; j < blen; j++)
            C[j + m] ^= gf16_mul(factor, B[j]);

        if (2 * L <= i) {
            L = i + 1 - L;
            memcpy(B, T, (size_t)(n + 2) * sizeof(uint16_t));
            blen = tlen;
            b = d;
            m = 1;
        } else {
            m++;
        }

        if (L > BM16_MAX_L) {
            out->length = L;
            free(C); free(B); free(T);
            return L;
        }
    }

    out->length = L;
    for (int j = 0; j < L && j < BM16_MAX_L; j++)
        out->coeffs[j] = C[j + 1];

    free(C); free(B); free(T);
    return L;
}

int lfsr16_errors(const LFSR16 *lfsr, const uint16_t *seq, int n)
{
    int L = lfsr->length;
    if (L >= n || L <= 0) return (L >= n) ? 0 : n;

    uint16_t *pred = (uint16_t *)malloc((size_t)n * sizeof(uint16_t));
    if (!pred) return n;

    /* Seed with the first L words */
    for (int i = 0; i < L; i++) pred[i] = seq[i];

    /* Run recurrence */
    for (int i = L; i < n; i++) {
        uint16_t s = 0;
        for (int j = 0; j < L; j++)
            s ^= gf16_mul(lfsr->coeffs[j], pred[i - 1 - j]);
        pred[i] = s;
    }

    int errors = 0;
    for (int i = L; i < n; i++)
        if (pred[i] != seq[i]) errors++;

    free(pred);
    return errors;
}

void lfsr16_run(const LFSR16 *lfsr, const uint16_t *seed, uint16_t *out, int count)
{
    int L = lfsr->length;
    if (count <= 0) return;

    /* Seed the first L positions directly from the input seed */
    int seed_fill = L < count ? L : count;
    for (int i = 0; i < seed_fill; i++) out[i] = seed[i];

    /* Run recurrence for the remaining count-L positions */
    for (int i = L; i < count; i++) {
        uint16_t s = 0;
        for (int j = 0; j < L; j++)
            s ^= gf16_mul(lfsr->coeffs[j], out[i - 1 - j]);
        out[i] = s;
    }
}
