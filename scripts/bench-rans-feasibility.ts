// Roadmap 2, Priority 3: rANS/range entropy coding — verdict, NOT implemented.
//
// Rather than write a full rANS codec just to find out whether it helps, this
// tests the hypothesis analytically first: a static order-0 entropy coder
// (rANS, range coding, Huffman) can never beat a stream's Shannon entropy
// bound (that's the definition of entropy), so if deflate/brotli already
// reach or beat that bound, no amount of rANS effort can do better.
//
// Findings:
//  - Small skewed categorical streams (model IDs, transform IDs) show a real
//    gap versus the entropy bound — deflate/brotli's own container overhead
//    dominates at that size, and a compact static frequency table plausibly
//    would not. But those aren't actually *batched streams* in the current
//    wire format: each ID is one inline byte in its own chunk header, never
//    collected together, so there is nothing for rANS to operate on without
//    a larger restructuring (batching many chunks' metadata into one stream)
//    — a materially bigger change than "add rANS as one more residual-packing
//    candidate," and out of scope for this priority's evaluation.
//  - The one stream that IS already batched in the current format — packed
//    residual values — shows no clean win: genuinely uniform noise (the
//    common case once real bit-flip corruption is modeled without RNG
//    artifacts) has ~8 bits/byte entropy already, leaving nothing for any
//    entropy coder, static or adaptive, to exploit.
//
// Given the one architecture-compatible use case shows no benefit, and the
// promising-looking use cases require a bigger restructuring this priority
// doesn't include, implementing rANS now would be speculative effort against
// unclear payoff — not implemented. Revisit if a future priority introduces
// an actual batched small-alphabet metadata stream.

import { deflateRawSync, brotliCompressSync, constants } from "zlib"
import { shannonEntropy } from "../src/core/entropy"

const lcg = (seed: number) => { let s = seed; return () => { s = (s*1103515245+12345)&0x7fffffff; return s/0x7fffffff } }

// A static order-0 entropy coder (rANS/range/Huffman) can never beat the
// Shannon entropy bound for a stream (that's the definition of entropy). If
// deflate/brotli already reach or beat that bound, rANS cannot possibly help
// -- no need to implement it to know that.
const entropyBytes = (buf: Uint8Array) => Math.ceil(shannonEntropy(buf) * buf.length / 8)
const bestOf = (buf: Uint8Array) => Math.min(
  deflateRawSync(buf, { level: 9 }).length,
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length,
)

const scenarios: [string, Uint8Array][] = []

// Residual VALUE stream (skewed toward a few XOR masks -- rANS's best case per the roadmap)
{
  const rng = lcg(1)
  const masks = [0x01, 0x80, 0xff]
  const vals = Uint8Array.from({ length: 2000 }, () => rng() < 0.7 ? masks[Math.floor(rng()*masks.length)]! : Math.floor(rng()*256))
  scenarios.push(["residual values (skewed toward 3 masks)", vals])
}
// Model IDs (small categorical alphabet, skewed)
{
  const rng = lcg(2)
  const ids = Uint8Array.from({ length: 500 }, () => rng() < 0.8 ? 0 : 1 + Math.floor(rng()*4))
  scenarios.push(["model IDs (skewed categorical)", ids])
}
// Transform IDs (very small alphabet: 0,3,4,5)
{
  const rng = lcg(3)
  const alphabet = [0,3,4,5]
  const ids = Uint8Array.from({ length: 300 }, () => alphabet[Math.floor(rng()*alphabet.length)]!)
  scenarios.push(["transform IDs (4-symbol alphabet)", ids])
}
// Uniform random (rANS's worst case -- included for calibration)
{
  const rng = lcg(4)
  scenarios.push(["uniform random", Uint8Array.from({ length: 2000 }, () => Math.floor(rng()*256))])
}

for (const [name, buf] of scenarios) {
  const bound = entropyBytes(buf)
  const real = bestOf(buf)
  console.log(`${name.padEnd(40)} entropy-bound=${bound}B  deflate/brotli=${real}B  ${real <= bound ? "brotli already AT/BELOW entropy bound -> rANS cannot help" : "brotli above entropy bound -> rANS might help"}`)
}

// Realistic hardware bit-flip noise: XOR residual values are powers of 2
// (single-bit corruption) -- an 8-symbol alphabet, which is the kind of
// systematic skew this codec's actual target domain (PRBS/firmware/telecom
// single-bit errors) would plausibly produce.
{
  const rng = lcg(9)
  const bitFlips = [1,2,4,8,16,32,64,128]
  const vals = Uint8Array.from({ length: 2000 }, () => bitFlips[Math.floor(rng()*8)]!)
  const bound = entropyBytes(vals)
  const real = bestOf(vals)
  console.log(`${"single-bit-flip residual values".padEnd(40)} entropy-bound=${bound}B  deflate/brotli=${real}B  gap=${real-bound}B`)

  // Estimate a REALISTIC static rANS size: entropy bound + a compact frequency
  // table for an 8-symbol alphabet (say 8 symbols x 2 bytes freq + 8 bytes
  // symbol values = ~24B table) -- still worth it only if the gap clears that.
  const tableOverhead = 24
  console.log(`  realistic rANS estimate: ~${bound + tableOverhead}B (bound + ~${tableOverhead}B table) vs brotli ${real}B -> ${bound+tableOverhead < real ? "rANS likely WINS" : "rANS likely loses once table cost included"}`)
}
