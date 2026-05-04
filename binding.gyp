{
  "targets": [{
    "target_name": "pade_compress_addon",
    "type": "loadable_module",
    "sources": [
      "c/gf256.c",
      "c/gf_wide.c",
      "c/bm.c",
      "c/bm_wide.c",
      "c/analyze.c",
      "c/addon.c"
    ],
    "include_dirs": ["c"],
    "cflags": ["-O2", "-Wall"],
    "libraries": ["-lm"],
    "conditions": [
      ["OS=='mac'", {
        "xcode_settings": {
          "OTHER_CFLAGS": ["-O2", "-Wall"],
          "OTHER_LDFLAGS": ["-undefined dynamic_lookup"]
        }
      }]
    ]
  }]
}
