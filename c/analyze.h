#ifndef ANALYZE_H
#define ANALYZE_H

/* Algebraic structure analysis: segments a buffer and reports the
   GF(2^8) linear recurrence structure found in each region.       */

#include <stdint.h>
#include <stddef.h>

#define MAX_SEGMENTS 512

typedef enum { KIND_LFSR, KIND_RAW } SegKind;

typedef struct {
    size_t   offset;
    size_t   length;
    SegKind  kind;
    int      L;              /* LFSR order; 0 for raw */
    int      period;         /* ord(c) for L=1; -1 otherwise */
    uint8_t  coeffs[64];
    int      n_coeffs;
    float    noise_pct;      /* % of non-seed bytes that differ from prediction */
    char     recognition[128];
} SegmentInfo;

typedef struct {
    const char  *filename;   /* may be NULL */
    size_t       total_bytes;
    float        entropy;    /* bits/byte, whole file */
    SegmentInfo  segments[MAX_SEGMENTS];
    int          n_segments;
    float        structured_fraction;
    float        avg_L;      /* weighted by segment length */
    char         verdict[256];
} AnalysisResult;

/* Analyse buf[0..n-1]. filename is optional (used in output only). */
void analyze_buffer(const uint8_t *buf, size_t n,
                    const char *filename, AnalysisResult *out);

/* Print a human-readable report to stdout. */
void print_analysis(const AnalysisResult *r);

/* Print a machine-readable JSON report to stdout. */
void print_analysis_json(const AnalysisResult *r);

#endif /* ANALYZE_H */
