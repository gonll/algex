// Tests whether bumping the per-residual brotli quality (format.ts bestWireFor,
// currently 6) the same way the full-file wrapper was bumped to 11 this
// session would be a similarly clean win. It is not — documented here so a
// future session doesn't re-attempt this blind.
//
// The full-file bump (src/index.ts, wrapSmallest) won cleanly because it runs
// brotli exactly ONCE per compress() call. This call site is different: it
// runs once per residual-packing CANDIDATE (dense/split/rice/bitmap/RLE) per
// chunk, so the cost is multiplicative across however many chunks + packing
// candidates exist, while residual buffers are typically small and already
// close to incompressible (a working LFSR/cyclic fit's residual is either
// empty or genuinely sparse/noisy by construction) -- little room for a
// higher search quality to find, at a real, compounding cost.
//
// Measured directly (quality 6 vs 9 vs 11), same input both times:
//
//   test/gf-structured.bin (1MB, includes a real noisy L=3 segment):
//     quality  6:  10197 bytes   5.0s encode   (baseline)
//     quality  9:  10197 bytes   7.2s encode   (+42% time, ZERO ratio gain)
//     quality 11:  10197 bytes  12.0s encode  (+138% time, ZERO ratio gain)
//
//   test/real-world.bin (696KB, real PRBS + real compiled binaries):
//     quality  6: 325376 bytes   3.6s encode   (baseline)
//     quality  9: 325266 bytes   4.0s encode   (+11% time,  -0.03% size)
//     quality 11: 324379 bytes   5.6s encode   (+56% time,  -0.3%  size)
//
// Verdict: rejected. Left at quality 6.

console.log("See the comment at the top of this file for the measured before/after numbers.")
console.log("Reproduce by editing BROTLI_PARAM_QUALITY in src/codec/format.ts's bestWireFor and re-running:")
console.log("  npx tsx src/cli.ts bench test/gf-structured.bin")
console.log("  npx tsx scripts/bench-real-world.ts")
