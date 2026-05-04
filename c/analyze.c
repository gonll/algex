#include "analyze.h"
#include "bm.h"
#include "bm_wide.h"
#include "gf256.h"
#include "gf_wide.h"

#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* ── Chunking ────────────────────────────────────────────────────────────── */

#define WINDOW     32      /* entropy window width in bytes */
#define THRESHOLD  0.45f   /* bits/byte entropy delta to trigger a split */
#define MIN_CHUNK  128     /* smallest allowable chunk */
#define MAX_CHUNK  4096    /* largest chunk fed to BM (O(n^2) bound) */

#define NOISE_LIMIT        30.0f   /* max % noise for any approximate model */
#define MAX_OFFSET_SEARCH  32      /* max seed-start offset for L=1 search */
#define MAX_MODELS          9      /* how many candidate models we try */

static float window_entropy(const uint8_t *buf, size_t pos, int w)
{
    int freq[256] = {0};
    for (int i = 0; i < w; i++) freq[buf[pos + (size_t)i]]++;
    float e = 0.0f;
    for (int i = 0; i < 256; i++) {
        if (!freq[i]) continue;
        float p = (float)freq[i] / (float)w;
        e -= p * log2f(p);
    }
    return e;
}

/* Fill splits[] with byte offsets where entropy discontinuities occur.
   Returns the number of splits found (<=max_splits).                   */
static int find_splits(const uint8_t *buf, size_t n,
                        size_t *splits, int max_splits)
{
    if (n < (size_t)(2 * MIN_CHUNK + WINDOW)) return 0;

    int    count      = 0;
    size_t last_split = 0;
    float  prev_e     = window_entropy(buf, 0, WINDOW);

    for (size_t i = (size_t)WINDOW; i + (size_t)WINDOW <= n; i++) {
        /* enforce minimum distance from the previous split */
        if (i - last_split < (size_t)MIN_CHUNK) continue;
        /* ensure the right fragment won't be too small */
        if (n - i < (size_t)MIN_CHUNK) break;

        float e = window_entropy(buf, i, WINDOW);
        if (fabsf(e - prev_e) > THRESHOLD) {
            if (count < max_splits) splits[count++] = i;
            last_split = i;
            i += (size_t)MIN_CHUNK - 1;  /* skip ahead; loop i++ makes it MIN_CHUNK */
            prev_e = window_entropy(buf, i < n - (size_t)WINDOW ? i : n - (size_t)WINDOW, WINDOW);
        } else {
            prev_e = e;
        }
    }
    return count;
}

/* ── Shannon entropy for the whole file ─────────────────────────────────── */

static float shannon_entropy(const uint8_t *buf, size_t n)
{
    if (!n) return 0.0f;
    size_t freq[256] = {0};
    for (size_t i = 0; i < n; i++) freq[buf[i]]++;
    float e = 0.0f;
    for (int i = 0; i < 256; i++) {
        if (!freq[i]) continue;
        float p = (float)freq[i] / (float)n;
        e -= p * log2f(p);
    }
    return e;
}

/* ── PRBS / polynomial recognition ──────────────────────────────────────── */

/* Named higher-order polynomials: key = hex coefficients comma-separated. */
typedef struct { const char *key; const char *name; } NamedPoly;
static const NamedPoly NAMED[] = {
    { "01,01",       "Fibonacci L=2 (x^2+x+1, period 3)" },
    { "80,05",       "CRC-16/IBM characteristic poly split" },
    { "10,21",       "CRC-CCITT characteristic poly split" },
    { "1b,4e",       "L=2 GF test sequence" },
    { "57,2f",       "L=2 GF test sequence (variant)" },
    { "57,2f,11",    "L=3 GF test sequence" },
    { NULL, NULL }
};

static void coeff_key(const uint8_t *coeffs, int n, char *out, size_t out_sz)
{
    size_t pos = 0;
    for (int i = 0; i < n && pos + 4 < out_sz; i++) {
        if (i) out[pos++] = ',';
        pos += (size_t)snprintf(out + pos, out_sz - pos, "%02x", coeffs[i]);
    }
}

static void describe_l1(uint8_t c, float noise_pct, char *out, size_t out_sz)
{
    int ord = gf_order(c);
    if (ord == 255) {
        if (noise_pct < 1.0f)
            snprintf(out, out_sz, "PRBS-8 m-sequence (maximal-length, perfect)");
        else
            snprintf(out, out_sz, "PRBS-8 m-sequence (~%.1f%% noise)", (double)noise_pct);
    } else if (ord == 85) snprintf(out, out_sz, "order 85 (period 85)");
    else if (ord == 51)   snprintf(out, out_sz, "order 51 (period 51)");
    else if (ord == 17)   snprintf(out, out_sz, "order 17 (period 17)");
    else if (ord == 15)   snprintf(out, out_sz, "order 15 (period 15)");
    else if (ord == 5)    snprintf(out, out_sz, "order 5  (period 5)");
    else if (ord == 3)    snprintf(out, out_sz, "order 3  (period 3)");
    else if (ord == 1)    snprintf(out, out_sz, "identity (constant sequence)");
    else                  snprintf(out, out_sz, "order %d (period %d)", ord, ord);
}

static void describe_higher(const uint8_t *coeffs, int L,
                             float noise_pct, char *out, size_t out_sz)
{
    char key[256];
    coeff_key(coeffs, L, key, sizeof(key));

    for (const NamedPoly *p = NAMED; p->key; p++) {
        if (strcmp(p->key, key) == 0) {
            if (noise_pct < 1.0f)
                snprintf(out, out_sz, "%s (exact)", p->name);
            else
                snprintf(out, out_sz, "%s (~%.1f%% noise)", p->name, (double)noise_pct);
            return;
        }
    }

    /* Heuristic: if the last coefficient (constant term) is primitive,
       the recurrence may be a maximal-length sequence of period 2^(8L)-1. */
    int last_ord = gf_order(coeffs[L - 1]);
    const char *noise_str = noise_pct < 1.0f ? "exact" : "";
    char noise_buf[32] = "";
    if (noise_pct >= 1.0f) snprintf(noise_buf, sizeof(noise_buf), "~%.1f%% noise", (double)noise_pct);

    if (last_ord == 255)
        snprintf(out, out_sz, "L=%d LFSR (%s, possibly maximal-length)",
                 L, noise_pct < 1.0f ? noise_str : noise_buf);
    else
        snprintf(out, out_sz, "L=%d LFSR (%s)",
                 L, noise_pct < 1.0f ? noise_str : noise_buf);
}

/* ── Per-chunk analysis ──────────────────────────────────────────────────── */

/* Candidate model found by one of the detection strategies. */
typedef struct {
    int     L;
    float   noise_pct;
    uint8_t coeffs[BM_MAX_L];
    int     n_coeffs;
    int     valid;
    int     is_diff;     /* Model 6: diff-domain L=1 */
    int     is_stride2;  /* Model 7: stride-2 decimation L=1 */
    int     is_gf16;     /* Model 8: GF(2^16) BM */
} Model;

/* Commit the winning model into seg. */
static void commit_model(const Model *m, const uint8_t *chunk, size_t len,
                          size_t offset, SegmentInfo *seg)
{
    seg->offset    = offset;
    seg->length    = len;
    seg->kind      = KIND_LFSR;
    seg->L         = m->L;
    seg->n_coeffs  = m->n_coeffs > 0 ? m->n_coeffs : m->L;
    seg->noise_pct = m->noise_pct;
    seg->period    = -1;
    int copy_n = seg->n_coeffs < BM_MAX_L ? seg->n_coeffs : BM_MAX_L;
    memcpy(seg->coeffs, m->coeffs, (size_t)copy_n);

    if (m->is_diff) {
        snprintf(seg->recognition, sizeof(seg->recognition),
                 "differential L=1 (d[i]=seq[i]^seq[i-1] PRBS-8, coeff=0x%02x, ~%.1f%% noise)",
                 m->coeffs[0], (double)m->noise_pct);
    } else if (m->is_stride2) {
        snprintf(seg->recognition, sizeof(seg->recognition),
                 "stride-2 L=1 (even ch=0x%02x, odd ch=0x%02x, ~%.1f%% noise)",
                 m->coeffs[0], m->coeffs[1], (double)m->noise_pct);
    } else if (m->is_gf16) {
        int l16 = m->L / 2;  /* L was stored as bytes = 2*words */
        char noise_buf[32];
        if (m->noise_pct < 1.0f)
            snprintf(noise_buf, sizeof(noise_buf), "exact");
        else
            snprintf(noise_buf, sizeof(noise_buf), "~%.1f%% noise", (double)m->noise_pct);
        snprintf(seg->recognition, sizeof(seg->recognition),
                 "GF(2^16) L=%d LFSR (%s)", l16, noise_buf);
    } else if (m->L == 1) {
        seg->period = gf_order(m->coeffs[0]);
        describe_l1(m->coeffs[0], m->noise_pct,
                    seg->recognition, sizeof(seg->recognition));
    } else {
        describe_higher(m->coeffs, m->L, m->noise_pct,
                        seg->recognition, sizeof(seg->recognition));
    }
    (void)chunk;  /* not needed here; kept for symmetry */
}

/* Choose the best model: minimum L among all valid candidates.
   Ties in L broken by lower noise.                              */
static const Model *best_model(const Model *candidates, int n)
{
    const Model *best = NULL;
    for (int i = 0; i < n; i++) {
        if (!candidates[i].valid) continue;
        if (!best
            || candidates[i].L < best->L
            || (candidates[i].L == best->L
                && candidates[i].noise_pct < best->noise_pct))
            best = &candidates[i];
    }
    return best;
}

static void analyze_chunk(const uint8_t *chunk, size_t len,
                           size_t offset, SegmentInfo *seg)
{
    memset(seg, 0, sizeof(*seg));
    seg->offset = offset;
    seg->length = len;
    seg->period = -1;

    if (len < 2) {
        seg->kind = KIND_RAW;
        snprintf(seg->recognition, sizeof(seg->recognition),
                 "too short to analyse");
        return;
    }

    int n = (int)len;

    Model models[MAX_MODELS];
    memset(models, 0, sizeof(models));

    /* ── Model 0: exact Berlekamp-Massey ─────────────────────────────────── */
    LFSR lfsr;
    int bm_L = bm_solve(chunk, n, &lfsr);
    if (bm_L > 0 && bm_L <= BM_MAX_L && (float)bm_L / (float)n < 0.35f) {
        int err = lfsr_errors(&lfsr, chunk, n);
        models[0].L         = bm_L;
        models[0].noise_pct = (float)err / (float)(n - bm_L) * 100.0f;
        memcpy(models[0].coeffs, lfsr.coeffs, (size_t)bm_L);
        models[0].valid = 1;
    }

    /* ── Model 1: approx L=1 with seed-offset search ─────────────────────
       Tries seed offsets 0..4 so a small boundary rogue byte doesn't poison
       the seed and produce an artificially high-order BM polynomial.        */
    {
        uint8_t c1; int err1;
        int max_off = n > MAX_OFFSET_SEARCH ? MAX_OFFSET_SEARCH : (n > 8 ? n / 2 : 0);
        approx_l1_best_offset(chunk, n, max_off, &c1, &err1);
        float noise1 = (float)err1 / (float)(n - 1) * 100.0f;
        if (noise1 < NOISE_LIMIT) {
            models[1].L         = 1;
            models[1].noise_pct = noise1;
            models[1].coeffs[0] = c1;
            models[1].valid     = 1;
        }
    }

    /* ── Model 2: approx L=2 via sub-sequence BM voting ─────────────────── */
    if (n >= 2 * 2 + 4) {
        uint8_t c2[BM_MAX_L]; int err2;
        if (approx_ln(chunk, n, 2, c2, &err2) == 0) {
            float noise2 = (float)err2 / (float)(n - 2) * 100.0f;
            if (noise2 < NOISE_LIMIT) {
                models[2].L         = 2;
                models[2].noise_pct = noise2;
                memcpy(models[2].coeffs, c2, 2);
                models[2].valid     = 1;
            }
        }
    }

    /* ── Model 3: approx L=3 via sub-sequence BM voting ─────────────────── */
    if (n >= 2 * 3 + 4) {
        uint8_t c3[BM_MAX_L]; int err3;
        if (approx_ln(chunk, n, 3, c3, &err3) == 0) {
            float noise3 = (float)err3 / (float)(n - 3) * 100.0f;
            if (noise3 < NOISE_LIMIT) {
                models[3].L         = 3;
                models[3].noise_pct = noise3;
                memcpy(models[3].coeffs, c3, 3);
                models[3].valid     = 1;
            }
        }
    }

    /* ── Model 4: approx L=4 via sub-sequence BM voting ─────────────────── */
    if (n >= 2 * 4 + 4) {
        uint8_t c4[BM_MAX_L]; int err4;
        if (approx_ln(chunk, n, 4, c4, &err4) == 0) {
            float noise4 = (float)err4 / (float)(n - 4) * 100.0f;
            if (noise4 < NOISE_LIMIT) {
                models[4].L         = 4;
                models[4].noise_pct = noise4;
                memcpy(models[4].coeffs, c4, 4);
                models[4].valid     = 1;
            }
        }
    }

    /* ── Model 5: approx L=5 via sub-sequence BM voting ─────────────────── */
    if (n >= 2 * 5 + 4) {
        uint8_t c5[BM_MAX_L]; int err5;
        if (approx_ln(chunk, n, 5, c5, &err5) == 0) {
            float noise5 = (float)err5 / (float)(n - 5) * 100.0f;
            if (noise5 < NOISE_LIMIT) {
                models[5].L         = 5;
                models[5].noise_pct = noise5;
                memcpy(models[5].coeffs, c5, 5);
                models[5].valid     = 1;
            }
        }
    }

    /* ── Model 6: differential L=1 — d[i] = seq[i] ^ seq[i-1] ──────────── */
    if (n >= 3) {
        uint8_t cd; int errd;
        if (approx_l1_diff(chunk, n, &cd, &errd) == 0) {
            /* denominator: n-2 (first diff byte seeds, n-2 are predicted) */
            float noised = (float)errd / (float)(n - 2) * 100.0f;
            if (noised < NOISE_LIMIT) {
                models[6].L         = 1;
                models[6].noise_pct = noised;
                models[6].coeffs[0] = cd;
                models[6].n_coeffs  = 1;
                models[6].valid     = 1;
                models[6].is_diff   = 1;
            }
        }
    }

    /* ── Model 7: stride-2 decimation L=1 ───────────────────────────────── */
    if (n >= 8) {
        uint8_t ce2, co2; int ee2, eo2;
        int max_off2 = n / 4;
        if (max_off2 > MAX_OFFSET_SEARCH) max_off2 = MAX_OFFSET_SEARCH;
        if (approx_l1_stride2(chunk, n, max_off2, &ce2, &ee2, &co2, &eo2) == 0) {
            /* combined errors over n-2 non-seed bytes (approximate denominator) */
            float noise7 = (float)(ee2 + eo2) / (float)(n - 2) * 100.0f;
            if (noise7 < NOISE_LIMIT) {
                models[7].L           = 1;
                models[7].noise_pct   = noise7;
                models[7].coeffs[0]   = ce2;
                models[7].coeffs[1]   = co2;
                models[7].n_coeffs    = 2;
                models[7].valid       = 1;
                models[7].is_stride2  = 1;
            }
        }
    }

    /* ── Model 8: GF(2^16) Berlekamp-Massey ─────────────────────────────── */
    if (n >= 4 && (n & 1) == 0) {
        static int gf16_initialized = 0;
        if (!gf16_initialized) { gf16_init(); gf16_initialized = 1; }

        int nw = n / 2;
        uint16_t *words = (uint16_t *)malloc((size_t)nw * sizeof(uint16_t));
        if (words) {
            for (int k = 0; k < nw; k++)
                words[k] = ((uint16_t)chunk[2 * k] << 8) | chunk[2 * k + 1];
            LFSR16 lfsr16;
            int l16 = bm16_solve(words, nw, &lfsr16);
            if (l16 > 0 && l16 <= BM16_MAX_L
                    && (float)l16 / (float)nw < 0.35f) {
                int err16 = lfsr16_errors(&lfsr16, words, nw);
                float noise16 = (float)err16 / (float)(nw - l16) * 100.0f;
                if (noise16 < NOISE_LIMIT) {
                    models[8].L         = l16 * 2;  /* report as byte count */
                    models[8].noise_pct = noise16;
                    models[8].n_coeffs  = l16 * 2;
                    models[8].valid     = 1;
                    models[8].is_gf16   = 1;
                    /* pack 16-bit coefficients as byte pairs */
                    for (int k = 0; k < l16 && 2 * k + 1 < BM_MAX_L; k++) {
                        models[8].coeffs[2 * k]     = (uint8_t)(lfsr16.coeffs[k] >> 8);
                        models[8].coeffs[2 * k + 1] = (uint8_t)(lfsr16.coeffs[k] & 0xFF);
                    }
                }
            }
            free(words);
        }
    }

    /* ── Pick minimum L among valid models ───────────────────────────────── */
    const Model *winner = best_model(models, MAX_MODELS);
    if (winner) {
        commit_model(winner, chunk, len, offset, seg);
        return;
    }

    /* ── Interleaved L=1 detection (only if no single-stream model found) ── */
    if (n >= 8) {
        int half = n / 2;
        uint8_t *even_buf = (uint8_t *)malloc((size_t)half);
        uint8_t *odd_buf  = (uint8_t *)malloc((size_t)half);
        if (even_buf && odd_buf) {
            for (int k = 0; k < half; k++) {
                even_buf[k] = chunk[2 * k];
                odd_buf[k]  = chunk[2 * k + 1];
            }
            uint8_t ce, co; int ee, eo;
            approx_l1(even_buf, half, &ce, &ee);
            approx_l1(odd_buf,  half, &co, &eo);
            float ne = (float)ee / (float)(half - 1) * 100.0f;
            float no = (float)eo / (float)(half - 1) * 100.0f;
            if (ne < NOISE_LIMIT && no < NOISE_LIMIT) {
                seg->kind      = KIND_LFSR;
                seg->offset    = offset;
                seg->length    = len;
                seg->L         = 1;
                seg->n_coeffs  = 2;
                seg->coeffs[0] = ce;
                seg->coeffs[1] = co;
                seg->noise_pct = (ne + no) * 0.5f;
                seg->period    = -1;
                snprintf(seg->recognition, sizeof(seg->recognition),
                         "interleaved L=1 (ch0=0x%02x order %d, ch1=0x%02x order %d, ~%.1f%% noise)",
                         ce, gf_order(ce), co, gf_order(co), (double)seg->noise_pct);
            }
        }
        free(even_buf);
        free(odd_buf);
        if (seg->kind == KIND_LFSR) return;
    }

    seg->kind = KIND_RAW;
    snprintf(seg->recognition, sizeof(seg->recognition),
             "no algebraic structure detected");
}

/* ── Segment merging ─────────────────────────────────────────────────────── */

/* Two segments are mergeable if they have the same kind, same L, and same
   coefficients (or both are raw).  Merging collapses repeated 4KB chunks
   of the same LFSR into one readable line.                                  */
static int segments_match(const SegmentInfo *a, const SegmentInfo *b)
{
    if (a->kind != b->kind) return 0;
    if (a->kind == KIND_RAW) return 1;   /* all raw blocks merge */
    if (a->L != b->L) return 0;
    return memcmp(a->coeffs, b->coeffs, (size_t)a->L) == 0;
}

/* Collapse adjacent matching segments in-place. Returns new count. */
static int merge_segments(SegmentInfo *segs, int n)
{
    if (n <= 1) return n;
    int out = 0;
    segs[0].noise_pct = 0.0f;  /* will recompute as weighted average */

    for (int i = 1; i < n; i++) {
        if (segments_match(&segs[out], &segs[i])) {
            /* accumulate weighted noise and extend length */
            float total = (float)(segs[out].length + segs[i].length);
            segs[out].noise_pct =
                (segs[out].noise_pct * (float)segs[out].length +
                 segs[i].noise_pct  * (float)segs[i].length) / total;
            segs[out].length += segs[i].length;
        } else {
            segs[++out] = segs[i];
        }
    }
    return out + 1;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

void analyze_buffer(const uint8_t *buf, size_t n,
                    const char *filename, AnalysisResult *r)
{
    memset(r, 0, sizeof(*r));
    r->filename    = filename;
    r->total_bytes = n;
    r->entropy     = shannon_entropy(buf, n);

    if (!n) {
        snprintf(r->verdict, sizeof(r->verdict), "empty file");
        return;
    }

    /* Build split points: entropy-adaptive + MAX_CHUNK hard limit */
    size_t splits[MAX_SEGMENTS];
    int    n_splits = find_splits(buf, n, splits, MAX_SEGMENTS - 1);

    /* Add MAX_CHUNK force-splits within any resulting segment */
    size_t all_splits[MAX_SEGMENTS * 2 + 2];
    int    n_all = 0;
    size_t prev  = 0;
    for (int i = 0; i <= n_splits && n_all < MAX_SEGMENTS; i++) {
        size_t next = (i < n_splits) ? splits[i] : n;
        while (prev + MAX_CHUNK < next && n_all < MAX_SEGMENTS - 1) {
            prev += MAX_CHUNK;
            all_splits[n_all++] = prev;
        }
        if (i < n_splits) all_splits[n_all++] = next;
        prev = next;
    }

    /* Analyse each segment */
    size_t cursor = 0;
    int    si     = 0;
    for (int i = 0; i <= n_all && si < MAX_SEGMENTS; i++) {
        size_t end  = (i < n_all) ? all_splits[i] : n;
        size_t clen = end - cursor;
        if (!clen) { cursor = end; continue; }

        analyze_chunk(buf + cursor, clen, cursor, &r->segments[si++]);
        cursor = end;
    }
    /* Merge adjacent identical segments before reporting */
    r->n_segments = merge_segments(r->segments, si);

    /* Aggregate statistics */
    size_t struct_bytes = 0;
    double lc_sum       = 0.0;
    for (int i = 0; i < r->n_segments; i++) {
        const SegmentInfo *s = &r->segments[i];
        if (s->kind == KIND_LFSR) {
            struct_bytes += s->length;
            lc_sum       += (double)s->L * (double)s->length;
        }
    }

    r->structured_fraction = n > 0 ? (float)struct_bytes / (float)n : 0.0f;
    r->avg_L = struct_bytes > 0 ? (float)(lc_sum / (double)struct_bytes) : 0.0f;

    /* Verdict */
    int pct = (int)(r->structured_fraction * 100.0f + 0.5f);
    if (r->structured_fraction >= 0.9f)
        snprintf(r->verdict, sizeof(r->verdict),
                 "%d%% algebraically structured — compresses extremely well (LFSR/PRBS data)", pct);
    else if (r->structured_fraction >= 0.5f)
        snprintf(r->verdict, sizeof(r->verdict),
                 "%d%% algebraic structure — mixed LFSR + unstructured regions", pct);
    else if (r->structured_fraction > 0.0f)
        snprintf(r->verdict, sizeof(r->verdict),
                 "Mostly unstructured (only %d%% algebraic) — statistical codec will perform better", pct);
    else
        snprintf(r->verdict, sizeof(r->verdict),
                 "No GF(2^8) linear recurrence detected — use gzip/brotli/zstd");
}

/* ── Report formatting ───────────────────────────────────────────────────── */

void print_analysis_json(const AnalysisResult *r)
{
    printf("{\n");
    if (r->filename)
        printf("  \"file\": \"%s\",\n", r->filename);
    printf("  \"totalBytes\": %zu,\n", r->total_bytes);
    printf("  \"entropy\": %.4f,\n", (double)r->entropy);
    printf("  \"structuredFraction\": %.4f,\n", (double)r->structured_fraction);
    printf("  \"avgL\": %.2f,\n", (double)r->avg_L);
    printf("  \"verdict\": \"%s\",\n", r->verdict);
    printf("  \"segments\": [\n");
    for (int i = 0; i < r->n_segments; i++) {
        const SegmentInfo *s = &r->segments[i];
        printf("    {\"offset\": %zu, \"length\": %zu, \"kind\": \"%s\"",
               s->offset, s->length,
               s->kind == KIND_LFSR ? "lfsr" : "raw");
        if (s->kind == KIND_LFSR) {
            printf(", \"L\": %d, \"noisePct\": %.2f, \"recognition\": \"%s\"",
                   s->L, (double)s->noise_pct, s->recognition);
            if (s->n_coeffs > 0) {
                printf(", \"coeffs\": [");
                for (int j = 0; j < s->n_coeffs; j++) {
                    if (j) printf(", ");
                    printf("%d", s->coeffs[j]);
                }
                printf("]");
            }
        } else {
            printf(", \"recognition\": \"%s\"", s->recognition);
        }
        printf("}%s\n", i < r->n_segments - 1 ? "," : "");
    }
    printf("  ]\n}\n");
}

void print_analysis(const AnalysisResult *r)
{
    if (r->filename)
        printf("File:        %s\n", r->filename);
    printf("Size:        %zu bytes\n", r->total_bytes);
    printf("Entropy:     %.3f bits/byte\n", (double)r->entropy);
    printf("Structured:  %.1f%% algebraic\n",
           (double)(r->structured_fraction * 100.0f));
    if (r->structured_fraction > 0.0f)
        printf("Avg L:       %.2f (weighted LFSR order)\n", (double)r->avg_L);
    printf("Verdict:     %s\n", r->verdict);

    /* UTF-8 box-drawing separator */
    printf("\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80"
           "\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\n");

    printf("Segments (%d):\n", r->n_segments);

    for (int i = 0; i < r->n_segments; i++) {
        const SegmentInfo *s = &r->segments[i];

        /* Offset and length columns */
        printf("  +%8zu [%8zu B]  ", s->offset, s->length);

        /* Recognition string */
        printf("%s", s->recognition);

        if (s->kind == KIND_LFSR) {
            printf("  noise %.1f%%", (double)s->noise_pct);
            if (s->n_coeffs > 0) {
                printf("  coeffs [");
                int show = s->n_coeffs < 4 ? s->n_coeffs : 4;
                for (int j = 0; j < show; j++) {
                    if (j) printf(",");
                    printf("0x%02x", s->coeffs[j]);
                }
                if (s->n_coeffs > 4) printf(",...");
                printf("]");
            }
        }
        printf("\n");
    }
}
