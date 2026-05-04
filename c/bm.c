#include "bm.h"
#include "gf256.h"
#include <string.h>
#include <stdlib.h>
#include <math.h>

int bm_solve(const uint8_t *seq, int n, LFSR *out)
{
    memset(out, 0, sizeof(*out));
    if (n <= 0) return 0;
    if (n > BM_MAX_SEQ) n = BM_MAX_SEQ;

    uint8_t *C = (uint8_t *)calloc((size_t)(n + 2), 1);
    uint8_t *B = (uint8_t *)calloc((size_t)(n + 2), 1);
    uint8_t *T = (uint8_t *)calloc((size_t)(n + 2), 1);
    if (!C || !B || !T) { free(C); free(B); free(T); out->length = n; return n; }

    C[0] = 1; B[0] = 1;
    int clen = 1, blen = 1;
    int L = 0, m = 1;
    uint8_t b = 1;

    for (int i = 0; i < n; i++) {
        uint8_t d = seq[i];
        for (int j = 1; j <= L; j++)
            d ^= gf_mul(C[j], seq[i - j]);

        if (!d) { m++; continue; }

        memcpy(T, C, (size_t)(n + 2));
        int tlen = clen;

        uint8_t factor = gf_div(d, b);
        int needed = blen + m;
        if (needed > clen) clen = needed;
        for (int j = 0; j < blen; j++)
            C[j + m] ^= gf_mul(factor, B[j]);

        if (2 * L <= i) {
            L = i + 1 - L;
            memcpy(B, T, (size_t)(n + 2));
            blen = tlen;
            b = d;
            m = 1;
        } else {
            m++;
        }

        if (L > BM_MAX_L) {
            out->length = L;
            free(C); free(B); free(T);
            return L;
        }
    }

    out->length = L;
    for (int j = 0; j < L; j++) out->coeffs[j] = C[j + 1];

    free(C); free(B); free(T);
    return L;
}

void lfsr_run(const LFSR *lfsr, const uint8_t *init, uint8_t *out, int count)
{
    int L = lfsr->length;
    for (int i = 0; i < L && i < count; i++) out[i] = init[i];
    for (int i = L; i < count; i++) {
        uint8_t s = 0;
        for (int j = 0; j < L; j++)
            s ^= gf_mul(lfsr->coeffs[j], out[i - 1 - j]);
        out[i] = s;
    }
}

int lfsr_errors(const LFSR *lfsr, const uint8_t *seq, int n)
{
    int L = lfsr->length;
    if (L >= n) return 0;

    uint8_t *pred = (uint8_t *)malloc((size_t)n);
    if (!pred) return n;

    lfsr_run(lfsr, seq, pred, n);
    int errors = 0;
    for (int i = L; i < n; i++)
        if (pred[i] != seq[i]) errors++;

    free(pred);
    return errors;
}

int approx_l1(const uint8_t *seq, int n, uint8_t *coeff, int *err_count)
{
    if (n < 2) return -1;

    int     best_err = n + 1;
    uint8_t best_c   = 0;

    for (int c = 1; c < 256; c++) {
        uint8_t pred = seq[0];
        int err = 0;
        for (int i = 1; i < n; i++) {
            pred = gf_mul((uint8_t)c, pred);
            if (pred != seq[i]) { err++; pred = seq[i]; }
            if (err >= best_err) break;
        }
        if (err < best_err) { best_err = err; best_c = (uint8_t)c; }
    }

    *coeff     = best_c;
    *err_count = best_err;
    return 0;
}

int approx_l1_best_offset(const uint8_t *seq, int n, int max_offset,
                           uint8_t *coeff, int *err_count)
{
    if (n < 2) return -1;
    if (max_offset > n - 2) max_offset = n - 2;

    int     best_total = n + 1;
    uint8_t best_c     = 0;

    for (int off = 0; off <= max_offset; off++) {
        uint8_t c; int err;
        /* Run approx_l1 on the subsequence starting at 'off' */
        if (approx_l1(seq + off, n - off, &c, &err) < 0) continue;
        /* The 'off' prefix bytes are not predicted → add as errors */
        int total = off + err;
        if (total < best_total) { best_total = total; best_c = c; }
    }

    *coeff     = best_c;
    *err_count = best_total;
    return 0;
}

/* ── Quadruple-voting L=2 detector ───────────────────────────────────────── */

int approx_l2(const uint8_t *seq, int n, uint8_t *out_coeffs, int *out_err)
{
    if (n < 4) return -1;

    uint32_t *votes = (uint32_t *)calloc(256 * 256, sizeof(uint32_t));
    if (!votes) return -1;

    /* Pre-screen: vote on first 256 quadruples; bail if no 12.5% plurality. */
    int pre_limit = (n - 3 < 256) ? n - 3 : 256;
    int pre_votes = 0; uint32_t pre_max = 0;
    for (int i = 0; i < pre_limit; i++) {
        uint8_t a = seq[i], b = seq[i+1], c = seq[i+2], d = seq[i+3];
        uint8_t det = (uint8_t)(gf_mul(b, b) ^ gf_mul(a, c));
        if (!det) continue;
        uint8_t inv = gf_inv(det);
        uint8_t c1  = gf_mul((uint8_t)(gf_mul(c, b) ^ gf_mul(a, d)), inv);
        uint8_t c2  = gf_mul((uint8_t)(gf_mul(b, d) ^ gf_mul(c, c)), inv);
        uint32_t v  = ++votes[(int)c1 * 256 + c2];
        if (v > pre_max) pre_max = v;
        pre_votes++;
    }
    if (pre_votes > 0 && pre_max * 8 < (uint32_t)pre_votes) {
        free(votes); return -1;
    }

    /* Full vote. */
    memset(votes, 0, 256 * 256 * sizeof(uint32_t));
    int total = 0;
    for (int i = 0; i <= n - 4; i++) {
        uint8_t a = seq[i], b = seq[i+1], c = seq[i+2], d = seq[i+3];
        uint8_t det = (uint8_t)(gf_mul(b, b) ^ gf_mul(a, c));
        if (!det) continue;
        uint8_t inv = gf_inv(det);
        uint8_t c1  = gf_mul((uint8_t)(gf_mul(c, b) ^ gf_mul(a, d)), inv);
        uint8_t c2  = gf_mul((uint8_t)(gf_mul(b, d) ^ gf_mul(c, c)), inv);
        votes[(int)c1 * 256 + c2]++;
        total++;
    }
    if (!total) { free(votes); return -1; }

    int best_key = 0; uint32_t best_v = 0;
    for (int k = 0; k < 256 * 256; k++) {
        if (votes[k] > best_v) { best_v = votes[k]; best_key = k; }
    }
    free(votes);

    if (best_v * 4 < (uint32_t)total) return -1;

    uint8_t c1 = (uint8_t)(best_key >> 8);
    uint8_t c2 = (uint8_t)(best_key & 0xff);
    if (!c1 && !c2) return -1;

    /* Verify: threshold = 1 - 0.7^3 ≈ 0.657 (30% byte noise amplified 3×). */
    int errors = 0;
    for (int i = 2; i < n; i++) {
        if ((uint8_t)(gf_mul(c1, seq[i-1]) ^ gf_mul(c2, seq[i-2])) != seq[i])
            errors++;
    }
    if ((float)errors / (float)n > 0.657f) return -1;

    out_coeffs[0] = c1; out_coeffs[1] = c2;
    *out_err = errors;
    return 0;
}

/* ── Quinuple-pair-voting L=3 detector ───────────────────────────────────── */

int approx_l3(const uint8_t *seq, int n, uint8_t *out_coeffs, int *out_err)
{
    if (n < 8) return -1;

    uint32_t *votes = (uint32_t *)calloc(256 * 256, sizeof(uint32_t));
    if (!votes) return -1;

    /* Pre-screen: vote on first 256 quinuple pairs; bail if no 10% plurality. */
    {
        int  limit = (n - 4 < 256) ? n - 4 : 256;
        int  prev_valid = 0, pre_votes = 0; uint32_t pre_max = 0;
        uint8_t pp2 = 0, pp3 = 0, pq = 0;
        for (int i = 0; i < limit; i++) {
            uint8_t a=seq[i], b=seq[i+1], c=seq[i+2], d=seq[i+3], e=seq[i+4];
            uint8_t p2 = (uint8_t)(gf_mul(b,d)^gf_mul(c,c));
            uint8_t p3 = (uint8_t)(gf_mul(a,d)^gf_mul(b,c));
            uint8_t q  = (uint8_t)(gf_mul(d,d)^gf_mul(e,c));
            if (prev_valid) {
                uint8_t det = (uint8_t)(gf_mul(pp2,p3)^gf_mul(pp3,p2));
                if (det) {
                    uint8_t inv = gf_inv(det);
                    uint8_t c2v = gf_mul((uint8_t)(gf_mul(pq,p3)^gf_mul(q,pp3)), inv);
                    uint8_t c3v = gf_mul((uint8_t)(gf_mul(pp2,q)^gf_mul(p2,pq)), inv);
                    uint32_t v  = ++votes[(int)c2v * 256 + c3v];
                    if (v > pre_max) pre_max = v;
                    pre_votes++;
                }
            }
            pp2 = p2; pp3 = p3; pq = q; prev_valid = 1;
        }
        if (pre_votes > 0 && pre_max * 10 < (uint32_t)pre_votes) {
            free(votes); return -1;
        }
    }

    /* Full vote for (c2, c3). */
    memset(votes, 0, 256 * 256 * sizeof(uint32_t));
    int total = 0;
    {
        int prev_valid = 0;
        uint8_t pp2 = 0, pp3 = 0, pq = 0;
        for (int i = 0; i <= n - 5; i++) {
            uint8_t a=seq[i], b=seq[i+1], c=seq[i+2], d=seq[i+3], e=seq[i+4];
            uint8_t p2 = (uint8_t)(gf_mul(b,d)^gf_mul(c,c));
            uint8_t p3 = (uint8_t)(gf_mul(a,d)^gf_mul(b,c));
            uint8_t q  = (uint8_t)(gf_mul(d,d)^gf_mul(e,c));
            if (prev_valid) {
                uint8_t det = (uint8_t)(gf_mul(pp2,p3)^gf_mul(pp3,p2));
                if (det) {
                    uint8_t inv = gf_inv(det);
                    uint8_t c2v = gf_mul((uint8_t)(gf_mul(pq,p3)^gf_mul(q,pp3)), inv);
                    uint8_t c3v = gf_mul((uint8_t)(gf_mul(pp2,q)^gf_mul(p2,pq)), inv);
                    votes[(int)c2v * 256 + c3v]++;
                    total++;
                }
            }
            pp2 = p2; pp3 = p3; pq = q; prev_valid = 1;
        }
    }
    if (total < 4) { free(votes); return -1; }

    int best_key = 0; uint32_t best_v = 0;
    for (int k = 0; k < 256 * 256; k++) {
        if (votes[k] > best_v) { best_v = votes[k]; best_key = k; }
    }
    free(votes);

    if (best_v * 5 < (uint32_t)total) return -1;

    uint8_t c2 = (uint8_t)(best_key >> 8);
    uint8_t c3 = (uint8_t)(best_key & 0xff);

    /* Majority vote for c1 given (c2, c3). */
    uint32_t c1_votes[256]; memset(c1_votes, 0, sizeof(c1_votes));
    for (int i = 3; i < n; i++) {
        uint8_t sp = seq[i-1];
        if (!sp) continue;
        uint8_t res = (uint8_t)(seq[i] ^ gf_mul(c2, seq[i-2]) ^ gf_mul(c3, seq[i-3]));
        c1_votes[gf_mul(res, gf_inv(sp))]++;
    }
    uint8_t best_c1 = 0; uint32_t best_c1v = 0;
    for (int k = 0; k < 256; k++) {
        if (c1_votes[k] > best_c1v) { best_c1v = c1_votes[k]; best_c1 = k; }
    }
    if (!best_c1 && !c2 && !c3) return -1;

    /* Verify: threshold = 1 - 0.7^4 ≈ 0.760 (30% byte noise amplified 4×). */
    int errors = 0;
    for (int i = 3; i < n; i++) {
        uint8_t pred = (uint8_t)(gf_mul(best_c1,seq[i-1])^gf_mul(c2,seq[i-2])^gf_mul(c3,seq[i-3]));
        if (pred != seq[i]) errors++;
    }
    if ((float)errors / (float)n > 0.760f) return -1;

    out_coeffs[0] = best_c1; out_coeffs[1] = c2; out_coeffs[2] = c3;
    *out_err = errors;
    return 0;
}

/* ── Differential and stride-2 L=1 helpers ───────────────────────────────── */

#define STRIDE2_NOISE_LIMIT 30.0f

int approx_l1_diff(const uint8_t *seq, int n, uint8_t *coeff, int *err_count)
{
    if (n < 3) return -1;
    uint8_t *diff = (uint8_t *)malloc((size_t)(n - 1));
    if (!diff) return -1;
    for (int i = 0; i < n - 1; i++) diff[i] = seq[i + 1] ^ seq[i];
    int ret = approx_l1(diff, n - 1, coeff, err_count);
    free(diff);
    return ret;
}

int approx_l1_stride2(const uint8_t *seq, int n, int max_offset,
                      uint8_t *coeff_even, int *err_even,
                      uint8_t *coeff_odd,  int *err_odd)
{
    if (n < 4) return -1;
    int half = n / 2;
    uint8_t *ebuf = (uint8_t *)malloc((size_t)half);
    uint8_t *obuf = (uint8_t *)malloc((size_t)half);
    if (!ebuf || !obuf) { free(ebuf); free(obuf); return -1; }

    for (int i = 0; i < half; i++) {
        ebuf[i] = seq[2 * i];
        obuf[i] = seq[2 * i + 1];
    }

    int re = approx_l1_best_offset(ebuf, half, max_offset, coeff_even, err_even);
    int ro = approx_l1_best_offset(obuf, half, max_offset, coeff_odd,  err_odd);
    free(ebuf); free(obuf);

    if (re < 0 || ro < 0) return -1;

    float ne = (float)*err_even / (float)(half - 1) * 100.0f;
    float no = (float)*err_odd  / (float)(half - 1) * 100.0f;
    if (ne >= STRIDE2_NOISE_LIMIT || no >= STRIDE2_NOISE_LIMIT) return -1;
    return 0;
}

/* ── Approximate higher-order detection via sub-sequence BM voting ────────── */

#define MAX_DISTINCT_POLYS 256

int approx_ln(const uint8_t *seq, int n, int target_l,
              uint8_t *out_coeffs, int *out_err)
{
    int window = 2 * target_l + 4;
    if (n < window || target_l < 2 || target_l > BM_MAX_L) return -1;

    /* Allocate vote table on the heap (MAX_DISTINCT * BM_MAX_L = 16 KB) */
    uint8_t (*cands)[BM_MAX_L] =
        (uint8_t (*)[BM_MAX_L])calloc(MAX_DISTINCT_POLYS, BM_MAX_L);
    int *counts = (int *)calloc(MAX_DISTINCT_POLYS, sizeof(int));
    if (!cands || !counts) { free(cands); free(counts); return -1; }

    int n_cands = 0, total_windows = 0;
    LFSR lfsr;

    /* Stride by target_l so non-overlapping windows dominate in noisy data */
    int stride = target_l > 1 ? target_l : 1;
    for (int i = 0; i + window <= n; i += stride) {
        int l = bm_solve(seq + i, window, &lfsr);
        if (l != target_l) continue;

        /* Vote for this coefficient vector */
        int found = -1;
        for (int j = 0; j < n_cands; j++) {
            if (memcmp(cands[j], lfsr.coeffs, (size_t)target_l) == 0) {
                found = j; break;
            }
        }
        if (found >= 0) {
            counts[found]++;
        } else if (n_cands < MAX_DISTINCT_POLYS) {
            memcpy(cands[n_cands], lfsr.coeffs, (size_t)target_l);
            counts[n_cands++] = 1;
        }
        total_windows++;
    }

    if (total_windows < 2) { free(cands); free(counts); return -1; }

    /* Plurality winner */
    int best = 0;
    for (int j = 1; j < n_cands; j++)
        if (counts[j] > counts[best]) best = j;

    /* Require ≥20% plurality to guard against random coincidences */
    if (counts[best] * 5 < total_windows) {
        free(cands); free(counts); return -1;
    }

    /* Verify on full sequence with seed-offset search.
       Trying offsets 0..L handles the case where the first L bytes are
       noise, which would otherwise poison the seed and cause divergence. */
    LFSR verify;
    verify.length = target_l;
    memcpy(verify.coeffs, cands[best], (size_t)target_l);

    int best_total = n + 1;
    int max_soff = target_l;
    if (max_soff > n - target_l - 1) max_soff = n - target_l - 1;

    uint8_t *pred = (uint8_t *)malloc((size_t)n);
    if (!pred) { free(cands); free(counts); return -1; }

    for (int soff = 0; soff <= max_soff; soff++) {
        int rem = n - soff;
        lfsr_run(&verify, seq + soff, pred, rem);
        int tail_err = 0;
        for (int k = target_l; k < rem; k++)
            if (pred[k] != seq[soff + k]) tail_err++;
        int total = soff + tail_err;
        if (total < best_total) best_total = total;
    }
    free(pred);
    *out_err = best_total;

    float noise_pct  = (float)*out_err / (float)(n - target_l) * 100.0f;
    float threshold  = 100.0f * (1.0f - powf(0.7f, (float)(target_l + 1)));

    if (noise_pct > threshold) { free(cands); free(counts); return -1; }

    memcpy(out_coeffs, cands[best], (size_t)target_l);
    free(cands); free(counts);
    return 0;
}
