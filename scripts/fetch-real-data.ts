// Builds test/real-data/ — a benchmark corpus of genuinely real, publicly
// available files spanning the codec's target domains, for real-world
// measurements to back up any pitch (not just synthetic fixtures).
//
// Everything here is either:
//   (a) downloaded from a public, freely-redistributable source (documented
//       with exact URL + license in test/real-data/MANIFEST.md), or
//   (b) generated locally from a public, standardized specification (the
//       ITU-T O.150 PRBS polynomials) — mathematically exact, not "inspired
//       by" or synthetic-approximation data.
//
// test/real-data/ itself is gitignored (some sources, e.g. Raspberry Pi's
// firmware blobs, are fine for local research use but not something this
// repo should redistribute) — this script is what's committed, so the corpus
// is reproducible. Run: npx tsx scripts/fetch-real-data.ts

import { writeFileSync, mkdirSync, existsSync } from "fs"
import { execSync } from "child_process"

const DIR = "test/real-data"

const download = (url: string, out: string) => {
  if (existsSync(out)) { console.log(`skip (exists): ${out}`); return }
  console.log(`downloading ${url} -> ${out}`)
  execSync(`curl -sL "${url}" -o "${out}" --max-time 90`)
}

mkdirSync(`${DIR}/firmware`, { recursive: true })
mkdirSync(`${DIR}/pcap`, { recursive: true })
mkdirSync(`${DIR}/image`, { recursive: true })
mkdirSync(`${DIR}/prbs`, { recursive: true })

// -- Real embedded firmware/kernel binaries --
// Source: Raspberry Pi Foundation's public firmware repo (BSD/proprietary-
// blob mix, published specifically for public download and on-device use;
// used here only for local research, not redistributed further).
const FW_BASE = "https://raw.githubusercontent.com/raspberrypi/firmware/master/boot"
download(`${FW_BASE}/bootcode.bin`, `${DIR}/firmware/bootcode.bin`)
download(`${FW_BASE}/fixup.dat`,    `${DIR}/firmware/fixup.dat`)
download(`${FW_BASE}/start.elf`,    `${DIR}/firmware/start.elf`)
download(`${FW_BASE}/kernel8.img`,  `${DIR}/firmware/kernel8.img`)

// -- Real network protocol captures --
// Source: Wireshark's official public sample-capture wiki (published for
// public download and use in exactly this kind of testing).
const WS_BASE = "https://wiki.wireshark.org/uploads"
download(`${WS_BASE}/27707187aeb30df68e70c8fb9d614981/http.cap`,                    `${DIR}/pcap/http.cap`)
download(`${WS_BASE}/1b328a71c8c503e5bfdeb2fe143402af/dhcpv6_1.pcap`,                `${DIR}/pcap/dhcpv6_1.pcap`)
download(`${WS_BASE}/204b8eb1a66421c6f9324d4211f6ed45/STP_UplinkFast.pcapng`,        `${DIR}/pcap/STP_UplinkFast.pcapng`)
download(`${WS_BASE}/1868d73fee89fce9d77c6ba21929e773/sip-rtp-opus-hybrid.pcap`,     `${DIR}/pcap/sip-rtp-opus-hybrid.pcap`)

// -- Real public-domain image (control case: outside the codec's win zone) --
// Source: NASA image library (US government work, public domain).
download("https://images-assets.nasa.gov/image/PIA23122/PIA23122~orig.jpg", `${DIR}/image/nasa_pia23122.jpg`)

// -- Real ITU-T O.150 PRBS test patterns --
// Not downloaded: generated locally from the public, standardized Fibonacci
// LFSR polynomials (x^N + x^k + 1) that real SONET/SDH/USB/PCIe BERT hardware
// implements. Same generator validated in scripts/gen-real-world-file.ts —
// see that file's header for the correctness notes (right-shift convention,
// degenerate-state guard).
const PRBS_POLYS: Record<string, { order: number; taps: number[] }> = {
  prbs7:  { order: 7,  taps: [7, 6] },
  prbs9:  { order: 9,  taps: [9, 5] },
  prbs11: { order: 11, taps: [11, 9] },
  prbs15: { order: 15, taps: [15, 14] },
  prbs20: { order: 20, taps: [20, 3] },
  prbs23: { order: 23, taps: [23, 18] },
  prbs31: { order: 31, taps: [31, 28] },
}

const genPRBS = (name: string, nBytes: number): Uint8Array => {
  const { order, taps } = PRBS_POLYS[name]!
  const mask = order === 31 ? 0x7fffffff : (1 << order) - 1
  let state = 1
  const out = new Uint8Array(nBytes)
  for (let i = 0; i < nBytes; i++) {
    let byte = 0
    for (let b = 0; b < 8; b++) {
      let fb = 0
      for (const t of taps) fb ^= (state >>> (t - 1)) & 1
      state = ((state << 1) | fb) >>> 0 & mask
      if (state === 0) throw new Error(`${name}: LFSR degenerated to all-zero state`)
      byte = (byte << 1) | fb
    }
    out[i] = byte
  }
  return out
}

for (const name of Object.keys(PRBS_POLYS)) {
  const out = `${DIR}/prbs/${name}.bin`
  if (existsSync(out)) { console.log(`skip (exists): ${out}`); continue }
  writeFileSync(out, genPRBS(name, 128 * 1024))
  console.log(`generated ${out} (128 KB)`)
}

console.log("\nDone. See test/real-data/MANIFEST.md for sources and licenses.")
