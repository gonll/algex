#include <node_api.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include "gf256.h"
#include "gf_wide.h"
#include "bm.h"
#include "bm_wide.h"
#include "analyze.h"

#define NAPI_CALL(env, call)                                      \
  do {                                                            \
    napi_status _s = (call);                                      \
    if (_s != napi_ok) {                                          \
      const napi_extended_error_info *info = NULL;                \
      napi_get_last_error_info((env), &info);                     \
      napi_throw_error((env), NULL,                               \
        info && info->error_message ? info->error_message         \
                                    : "N-API call failed");       \
      return NULL;                                                 \
    }                                                             \
  } while (0)

/* bmSolve(buf: Buffer): { length: number, coeffs: number[] } */
static napi_value js_bm_solve(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  if (len > BM_MAX_SEQ) {
    napi_throw_range_error(env, NULL, "buffer exceeds BM_MAX_SEQ");
    return NULL;
  }

  LFSR lfsr;
  memset(&lfsr, 0, sizeof(lfsr));
  int L = bm_solve(data, (int)len, &lfsr);

  napi_value result, length_val, coeffs_arr;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_int32(env, L, &length_val));
  NAPI_CALL(env, napi_set_named_property(env, result, "length", length_val));

  NAPI_CALL(env, napi_create_array_with_length(env, (size_t)lfsr.length, &coeffs_arr));
  for (int i = 0; i < lfsr.length && i < BM_MAX_L; i++) {
    napi_value v;
    NAPI_CALL(env, napi_create_uint32(env, lfsr.coeffs[i], &v));
    NAPI_CALL(env, napi_set_element(env, coeffs_arr, (uint32_t)i, v));
  }
  NAPI_CALL(env, napi_set_named_property(env, result, "coeffs", coeffs_arr));
  return result;
}

/* lfsrRun(coeffs: number[], seed: Buffer, count: number): Buffer */
static napi_value js_lfsr_run(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint32_t arr_len;
  NAPI_CALL(env, napi_get_array_length(env, args[0], &arr_len));
  if (arr_len > BM_MAX_L) {
    napi_throw_range_error(env, NULL, "coeffs length exceeds BM_MAX_L");
    return NULL;
  }

  LFSR lfsr;
  memset(&lfsr, 0, sizeof(lfsr));
  lfsr.length = (int)arr_len;
  for (uint32_t i = 0; i < arr_len; i++) {
    napi_value elem;
    uint32_t v;
    NAPI_CALL(env, napi_get_element(env, args[0], i, &elem));
    NAPI_CALL(env, napi_get_value_uint32(env, elem, &v));
    lfsr.coeffs[i] = (uint8_t)v;
  }

  uint8_t *seed_data; size_t seed_len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[1], (void **)&seed_data, &seed_len));

  int32_t count;
  NAPI_CALL(env, napi_get_value_int32(env, args[2], &count));
  if (count < 0) { napi_throw_range_error(env, NULL, "count must be >= 0"); return NULL; }

  uint8_t *out = malloc((size_t)count);
  if (!out) { napi_throw_error(env, NULL, "out of memory"); return NULL; }

  lfsr_run(&lfsr, seed_data, out, count);

  napi_value buf;
  void *node_buf;
  /* napi_create_buffer copies from external pointer — we free after */
  napi_status s = napi_create_buffer_copy(env, (size_t)count, out, &node_buf, &buf);
  free(out);
  if (s != napi_ok) { napi_throw_error(env, NULL, "buffer alloc failed"); return NULL; }
  return buf;
}

/* approxL1(buf: Buffer): { coeff: number, errCount: number } */
static napi_value js_approx_l1(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  uint8_t coeff = 0; int err = 0;
  if (approx_l1(data, (int)len, &coeff, &err) != 0) {
    napi_throw_error(env, NULL, "approx_l1 failed: buffer too short");
    return NULL;
  }

  napi_value result, cv, ev;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_uint32(env, coeff, &cv));
  NAPI_CALL(env, napi_create_int32(env, err, &ev));
  NAPI_CALL(env, napi_set_named_property(env, result, "coeff", cv));
  NAPI_CALL(env, napi_set_named_property(env, result, "errCount", ev));
  return result;
}

/* approxL1BestOffset(buf: Buffer, maxOffset: number): { coeff: number, errCount: number } */
static napi_value js_approx_l1_best_offset(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  int32_t max_offset;
  NAPI_CALL(env, napi_get_value_int32(env, args[1], &max_offset));

  uint8_t coeff = 0; int err = 0;
  if (approx_l1_best_offset(data, (int)len, max_offset, &coeff, &err) != 0) {
    napi_throw_error(env, NULL, "approx_l1_best_offset failed: buffer too short");
    return NULL;
  }

  napi_value result, cv, ev;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_uint32(env, coeff, &cv));
  NAPI_CALL(env, napi_create_int32(env, err, &ev));
  NAPI_CALL(env, napi_set_named_property(env, result, "coeff", cv));
  NAPI_CALL(env, napi_set_named_property(env, result, "errCount", ev));
  return result;
}

/* approxLn(buf: Buffer, targetL: number): { coeffs: number[], err: number } | null */
static napi_value js_approx_ln(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  int32_t target_l;
  NAPI_CALL(env, napi_get_value_int32(env, args[1], &target_l));
  if (target_l <= 0 || target_l > BM_MAX_L) {
    napi_throw_range_error(env, NULL, "targetL out of range");
    return NULL;
  }

  uint8_t out_coeffs[BM_MAX_L];
  int out_err = 0;
  int rc = approx_ln(data, (int)len, target_l, out_coeffs, &out_err);

  if (rc != 0) {
    napi_value null_val;
    napi_get_null(env, &null_val);
    return null_val;
  }

  napi_value result, coeffs_arr, ev;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_array_with_length(env, (size_t)target_l, &coeffs_arr));
  for (int i = 0; i < target_l; i++) {
    napi_value v;
    NAPI_CALL(env, napi_create_uint32(env, out_coeffs[i], &v));
    NAPI_CALL(env, napi_set_element(env, coeffs_arr, (uint32_t)i, v));
  }
  NAPI_CALL(env, napi_create_int32(env, out_err, &ev));
  NAPI_CALL(env, napi_set_named_property(env, result, "coeffs", coeffs_arr));
  NAPI_CALL(env, napi_set_named_property(env, result, "err", ev));
  return result;
}

/* approxL2(buf: Buffer): { coeffs: number[], err: number } | null */
static napi_value js_approx_l2(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  uint8_t coeffs[2]; int err = 0;
  if (approx_l2(data, (int)len, coeffs, &err) != 0) {
    napi_value nv; napi_get_null(env, &nv); return nv;
  }

  napi_value result, coeffs_arr, ev, v0, v1;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_array_with_length(env, 2, &coeffs_arr));
  NAPI_CALL(env, napi_create_uint32(env, coeffs[0], &v0));
  NAPI_CALL(env, napi_create_uint32(env, coeffs[1], &v1));
  NAPI_CALL(env, napi_set_element(env, coeffs_arr, 0, v0));
  NAPI_CALL(env, napi_set_element(env, coeffs_arr, 1, v1));
  NAPI_CALL(env, napi_create_int32(env, err, &ev));
  NAPI_CALL(env, napi_set_named_property(env, result, "coeffs", coeffs_arr));
  NAPI_CALL(env, napi_set_named_property(env, result, "err", ev));
  return result;
}

/* approxL3(buf: Buffer): { coeffs: number[], err: number } | null */
static napi_value js_approx_l3(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  uint8_t coeffs[3]; int err = 0;
  if (approx_l3(data, (int)len, coeffs, &err) != 0) {
    napi_value nv; napi_get_null(env, &nv); return nv;
  }

  napi_value result, coeffs_arr, ev, v0, v1, v2;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_array_with_length(env, 3, &coeffs_arr));
  NAPI_CALL(env, napi_create_uint32(env, coeffs[0], &v0));
  NAPI_CALL(env, napi_create_uint32(env, coeffs[1], &v1));
  NAPI_CALL(env, napi_create_uint32(env, coeffs[2], &v2));
  NAPI_CALL(env, napi_set_element(env, coeffs_arr, 0, v0));
  NAPI_CALL(env, napi_set_element(env, coeffs_arr, 1, v1));
  NAPI_CALL(env, napi_set_element(env, coeffs_arr, 2, v2));
  NAPI_CALL(env, napi_create_int32(env, err, &ev));
  NAPI_CALL(env, napi_set_named_property(env, result, "coeffs", coeffs_arr));
  NAPI_CALL(env, napi_set_named_property(env, result, "err", ev));
  return result;
}

/* bm16Solve(buf: Buffer): { length: number, coeffs: number[] }
   buf contains uint16 words packed little-endian (2 bytes each). */
static napi_value js_bm16_solve(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  if (len % 2 != 0) {
    napi_throw_error(env, NULL, "bm16Solve: buffer length must be even");
    return NULL;
  }

  int n = (int)(len / 2);
  const uint16_t *seq = (const uint16_t *)data;  /* assumes LE host */

  LFSR16 lfsr;
  memset(&lfsr, 0, sizeof(lfsr));
  int L = bm16_solve(seq, n, &lfsr);

  napi_value result, length_val, coeffs_arr;
  NAPI_CALL(env, napi_create_object(env, &result));
  NAPI_CALL(env, napi_create_int32(env, L, &length_val));
  NAPI_CALL(env, napi_set_named_property(env, result, "length", length_val));

  int nc = (L < BM16_MAX_L) ? L : 0;  /* zeroed if L exceeded cap */
  NAPI_CALL(env, napi_create_array_with_length(env, (size_t)nc, &coeffs_arr));
  for (int i = 0; i < nc; i++) {
    napi_value v;
    NAPI_CALL(env, napi_create_uint32(env, lfsr.coeffs[i], &v));
    NAPI_CALL(env, napi_set_element(env, coeffs_arr, (uint32_t)i, v));
  }
  NAPI_CALL(env, napi_set_named_property(env, result, "coeffs", coeffs_arr));
  return result;
}

/* lfsr16Run(coeffs: number[], seed: Buffer, count: number): Buffer
   coeffs: uint16 values as JS numbers; seed: uint16 LE Buffer (L words);
   count: total uint16 words to generate; returns uint16 LE Buffer. */
static napi_value js_lfsr16_run(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint32_t arr_len;
  NAPI_CALL(env, napi_get_array_length(env, args[0], &arr_len));
  if (arr_len > BM16_MAX_L) {
    napi_throw_range_error(env, NULL, "lfsr16Run: coeffs exceeds BM16_MAX_L");
    return NULL;
  }

  LFSR16 lfsr;
  memset(&lfsr, 0, sizeof(lfsr));
  lfsr.length = (int)arr_len;
  for (uint32_t i = 0; i < arr_len; i++) {
    napi_value elem; uint32_t v;
    NAPI_CALL(env, napi_get_element(env, args[0], i, &elem));
    NAPI_CALL(env, napi_get_value_uint32(env, elem, &v));
    lfsr.coeffs[i] = (uint16_t)v;
  }

  uint8_t *seed_data; size_t seed_len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[1], (void **)&seed_data, &seed_len));

  int32_t count;
  NAPI_CALL(env, napi_get_value_int32(env, args[2], &count));
  if (count < 0) { napi_throw_range_error(env, NULL, "count must be >= 0"); return NULL; }

  uint16_t *out = (uint16_t *)malloc((size_t)count * sizeof(uint16_t));
  if (!out) { napi_throw_error(env, NULL, "out of memory"); return NULL; }

  lfsr16_run(&lfsr, (const uint16_t *)seed_data, out, count);

  napi_value buf;
  void *node_buf;
  napi_status s = napi_create_buffer_copy(env, (size_t)count * 2, out, &node_buf, &buf);
  free(out);
  if (s != napi_ok) { napi_throw_error(env, NULL, "buffer alloc failed"); return NULL; }
  return buf;
}

/* analyzeBuffer(buf: Buffer, filename?: string): string (JSON) */
static napi_value js_analyze_buffer(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  uint8_t *data; size_t len;
  NAPI_CALL(env, napi_get_buffer_info(env, args[0], (void **)&data, &len));

  char *filename = NULL;
  if (argc >= 2) {
    napi_valuetype vt;
    napi_typeof(env, args[1], &vt);
    if (vt == napi_string) {
      size_t fname_len;
      napi_get_value_string_utf8(env, args[1], NULL, 0, &fname_len);
      filename = malloc(fname_len + 1);
      if (filename) napi_get_value_string_utf8(env, args[1], filename, fname_len + 1, NULL);
    }
  }

  AnalysisResult r;
  memset(&r, 0, sizeof(r));
  analyze_buffer(data, len, filename, &r);

  /* Capture print_analysis_json output by redirecting stdout to a pipe. */
  int pipefd[2];
  if (pipe(pipefd) != 0) {
    napi_throw_error(env, NULL, "pipe() failed");
    return NULL;
  }

  int saved_stdout = dup(STDOUT_FILENO);
  dup2(pipefd[1], STDOUT_FILENO);
  close(pipefd[1]);

  print_analysis_json(&r);
  fflush(stdout);

  dup2(saved_stdout, STDOUT_FILENO);
  close(saved_stdout);

  /* Read all captured output from the read end. */
  char *json_buf = NULL;
  size_t json_len = 0;
  char tmp[4096];
  ssize_t n;
  while ((n = read(pipefd[0], tmp, sizeof(tmp))) > 0) {
    char *next = realloc(json_buf, json_len + (size_t)n + 1);
    if (!next) { free(json_buf); close(pipefd[0]); napi_throw_error(env, NULL, "oom"); return NULL; }
    json_buf = next;
    memcpy(json_buf + json_len, tmp, (size_t)n);
    json_len += (size_t)n;
    json_buf[json_len] = '\0';
  }
  close(pipefd[0]);
  free(filename);

  if (!json_buf) { napi_throw_error(env, NULL, "empty JSON output"); return NULL; }

  napi_value str;
  napi_status s = napi_create_string_utf8(env, json_buf, json_len, &str);
  free(json_buf);
  if (s != napi_ok) { napi_throw_error(env, NULL, "string creation failed"); return NULL; }
  return str;
}

static napi_value Init(napi_env env, napi_value exports) {
  gf256_init();
  gf16_init();

  napi_property_descriptor props[] = {
    { "bmSolve",            NULL, js_bm_solve,              NULL, NULL, NULL, napi_enumerable, NULL },
    { "lfsrRun",            NULL, js_lfsr_run,              NULL, NULL, NULL, napi_enumerable, NULL },
    { "approxL1",           NULL, js_approx_l1,             NULL, NULL, NULL, napi_enumerable, NULL },
    { "approxL1BestOffset", NULL, js_approx_l1_best_offset, NULL, NULL, NULL, napi_enumerable, NULL },
    { "approxL2",           NULL, js_approx_l2,             NULL, NULL, NULL, napi_enumerable, NULL },
    { "approxL3",           NULL, js_approx_l3,             NULL, NULL, NULL, napi_enumerable, NULL },
    { "approxLn",           NULL, js_approx_ln,             NULL, NULL, NULL, napi_enumerable, NULL },
    { "analyzeBuffer",      NULL, js_analyze_buffer,        NULL, NULL, NULL, napi_enumerable, NULL },
    { "bm16Solve",          NULL, js_bm16_solve,            NULL, NULL, NULL, napi_enumerable, NULL },
    { "lfsr16Run",          NULL, js_lfsr16_run,            NULL, NULL, NULL, napi_enumerable, NULL },
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
