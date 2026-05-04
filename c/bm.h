#ifndef BM_H
#define BM_H

/* Berlekamp-Massey over GF(2^8) and LFSR utilities. */

#include <stdint.h>

/* Maximum LFSR order we will report; longer LFSRs are treated as unstructured. */
#define BM_MAX_L 64

/* Maximum sequence length passed to bm_solve (BM is O(n^2)). */
#define BM_MAX_SEQ 8192

typedef struct {
    uint8_t coeffs[BM_MAX_L];
    int     length;
} LFSR;

/* Find shortest LFSR generating seq[0..n-1].
   Returns L (LFSR length). If L > BM_MAX_L, out->length is set but
   out->coeffs is zeroed — caller should treat it as no structure.   */
int bm_solve(const uint8_t *seq, int n, LFSR *out);

/* Run LFSR for `count` steps.  out[0..L-1] = init, out[L..count-1]
   predicted by recurrence. out must hold at least count bytes.      */
void lfsr_run(const LFSR *lfsr, const uint8_t *init, uint8_t *out, int count);

/* Count positions i in [L,n) where lfsr_run prediction != seq[i].
   The first L positions are always correct (seed).                  */
int lfsr_errors(const LFSR *lfsr, const uint8_t *seq, int n);

/* Brute-force L=1 starting at offset 0: try all 255 non-zero
   coefficients, set *coeff and *err_count to the best pair.
   Returns 0 on success, -1 if n < 2.                               */
int approx_l1(const uint8_t *seq, int n, uint8_t *coeff, int *err_count);

/* Like approx_l1 but also tries seed offsets 0..max_offset.
   For each offset the prefix bytes count as errors against the total.
   Useful when the first few bytes are boundary noise.
   Returns 0 on success, -1 if n < 2.                               */
int approx_l1_best_offset(const uint8_t *seq, int n, int max_offset,
                           uint8_t *coeff, int *err_count);

/* Approximate LFSR detection for order target_l via sub-sequence BM voting.
   Runs BM on overlapping windows of length 2*target_l+4, votes on the
   plurality polynomial, then verifies on the full sequence.
   Sets out_coeffs[0..target_l-1] and *out_err on success.
   Returns 0 on success, -1 if no acceptable polynomial found.      */
int approx_ln(const uint8_t *seq, int n, int target_l,
              uint8_t *out_coeffs, int *out_err);

/* Quadruple-voting L=2 detector: for each (a,b,c,d)=seq[i..i+3] solve the
   2×2 GF system for (c1,c2), vote on plurality, then verify on full sequence.
   O(N). Sets out_coeffs[0..1] and *out_err.
   Returns 0 on success, -1 if no acceptable polynomial found.           */
int approx_l2(const uint8_t *seq, int n,
              uint8_t *out_coeffs, int *out_err);

/* Quinuple-pair-voting L=3 detector: votes on (c2,c3) via consecutive
   quinuple pairs, then majority-votes c1. O(N).
   Sets out_coeffs[0..2] and *out_err.
   Returns 0 on success, -1 if no acceptable polynomial found.           */
int approx_l3(const uint8_t *seq, int n,
              uint8_t *out_coeffs, int *out_err);

/* Run approx_l1 on the difference sequence d[i] = seq[i] ^ seq[i-1].
   Sets *coeff and *err_count. Returns 0 on success, -1 if n < 3.   */
int approx_l1_diff(const uint8_t *seq, int n,
                   uint8_t *coeff, int *err_count);

/* Run approx_l1_best_offset on stride-2 sub-sequences (even/odd indices).
   Returns 0 if both sub-sequences have noise < 30%, -1 otherwise.
   Sets *coeff_even, *err_even, *coeff_odd, *err_odd.               */
int approx_l1_stride2(const uint8_t *seq, int n, int max_offset,
                      uint8_t *coeff_even, int *err_even,
                      uint8_t *coeff_odd,  int *err_odd);

#endif /* BM_H */
