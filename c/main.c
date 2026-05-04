#include "gf256.h"
#include "analyze.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t *read_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); return NULL; }

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long sz = ftell(f);
    if (sz < 0) { fclose(f); return NULL; }
    rewind(f);

    uint8_t *buf = (uint8_t *)malloc((size_t)sz);
    if (!buf) { fclose(f); return NULL; }

    if (fread(buf, 1, (size_t)sz, f) != (size_t)sz) {
        free(buf); fclose(f); return NULL;
    }
    fclose(f);
    *out_len = (size_t)sz;
    return buf;
}

static uint8_t *read_stdin(size_t *out_len)
{
    size_t  cap = 65536, len = 0;
    uint8_t *buf = (uint8_t *)malloc(cap);
    if (!buf) return NULL;

    size_t n;
    while ((n = fread(buf + len, 1, cap - len, stdin)) > 0) {
        len += n;
        if (len == cap) {
            cap *= 2;
            uint8_t *tmp = (uint8_t *)realloc(buf, cap);
            if (!tmp) { free(buf); return NULL; }
            buf = tmp;
        }
    }
    *out_len = len;
    return buf;
}

int main(int argc, char *argv[])
{
    gf256_init();

    int         use_json = 0;
    const char *path     = NULL;
    uint8_t    *buf      = NULL;
    size_t      buflen   = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--json") == 0) use_json = 1;
        else if (!path) path = argv[i];
    }

    if (path && strcmp(path, "-") != 0) {
        buf = read_file(path, &buflen);
    } else {
        buf = read_stdin(&buflen);
    }

    if (!buf) {
        fprintf(stderr, "usage: gf-analyze [--json] <file>  (or pipe to stdin)\n");
        return 1;
    }

    AnalysisResult result;
    analyze_buffer(buf, buflen, path, &result);

    if (use_json) print_analysis_json(&result);
    else          print_analysis(&result);

    free(buf);
    return 0;
}
