#ifndef BM_WIDE_H
#define BM_WIDE_H

/* Berlekamp-Massey over GF(2^16). */

#include <stdint.h>

#define BM16_MAX_L 32   /* max LFSR order in 16-bit words (= 64 bytes) */

typedef struct {
    uint16_t coeffs[BM16_MAX_L];
    int      length;
} LFSR16;

/* Berlekamp-Massey over GF(2^16). seq is n uint16_t words.
   Returns L (LFSR length in words). If L > BM16_MAX_L, length is set
   but coeffs are zeroed — caller should treat it as unstructured.     */
int bm16_solve(const uint16_t *seq, int n, LFSR16 *out);

/* Count positions i in [L,n) where the LFSR prediction != seq[i]. */
int lfsr16_errors(const LFSR16 *lfsr, const uint16_t *seq, int n);

/* Generate count uint16 words into out[0..count-1].
   out[0..L-1] = seed[0..L-1]; out[L..count-1] = recurrence continuation.
   Mirrors lfsr_run from bm.h but over GF(2^16). */
void lfsr16_run(const LFSR16 *lfsr, const uint16_t *seed, uint16_t *out, int count);

#endif /* BM_WIDE_H */
