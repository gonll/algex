// Descarga las capturas CIEGAS del exp. 14 (lista cerrada en prereg-pcap.md) y las recorta a paquetes completos. No ejecuta el códec.
//   npx tsx scripts/lab-19c-fetch-blind.ts
import { execSync } from "child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs"
import { createHash } from "crypto"
import * as zlib from "zlib"

const DIR = "test/real-data/pcap-blind"; mkdirSync(DIR, { recursive: true })
const TARGET = 24_000_000
const curl = (url: string, out: string, range?: string) => execSync(`curl -sL -m 900 ${range ? `-r ${range}` : ""} "${url}" -o "${out}"`)
const info = (b: Uint8Array): { le: boolean; unit: number; link: number } => {
  const m = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0
  const le = m === 0xd4c3b2a1 || m === 0x4d3cb2a1, unit = m === 0x4d3cb2a1 || m === 0xa1b23c4d ? 1e9 : 1e6
  if (![0xd4c3b2a1, 0xa1b2c3d4, 0x4d3cb2a1, 0xa1b23c4d].includes(m)) throw new Error(`magic no soportado ${m.toString(16)}`)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); return { le, unit, link: dv.getUint32(20, le) }
}
const trim = (b: Uint8Array, le: boolean, target: number): Uint8Array => {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = 24
  while (p + 16 <= b.length) { const incl = dv.getUint32(p + 8, le); if (p + 16 + incl > b.length || p + 16 + incl > target) break; p += 16 + incl }
  return b.subarray(0, p)
}
const save = (name: string, b: Uint8Array) => {
  const f = `${DIR}/${name}`; writeFileSync(f, b)
  const i = info(b), dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = 24, n = 0
  while (p + 16 <= b.length) { const incl = dv.getUint32(p + 8, i.le); if (p + 16 + incl > b.length) break; p += 16 + incl; n++ }
  console.log(`${name}: ${b.length} bytes, ${n} paquetes, enlace ${i.link}, ${i.le ? "LE" : "BE"}, ${i.unit === 1e9 ? "ns" : "µs"}, sha256 ${createHash("sha256").update(b).digest("hex").slice(0, 16)}`)
}
// BL1 / BL2: prefijos de trazas MAWI (gzip). Un prefijo de un .gz se descomprime hasta donde llega.
for (const [name, url] of [["BL1_mawi_F_20230101_1400.pcap", "https://mawi.wide.ad.jp/mawi/samplepoint-F/2023/202301011400.pcap.gz"], ["BL2_mawi_F_20190601_1400.pcap", "https://mawi.wide.ad.jp/mawi/samplepoint-F/2019/201906011400.pcap.gz"]] as const) {
  if (existsSync(`${DIR}/${name}`)) { console.log(`ya existe ${name}`); continue }
  const tmp = `${DIR}/_${name}.gz`; curl(url, tmp, "0-9999999")
  const raw = zlib.gunzipSync(readFileSync(tmp), { finishFlush: zlib.constants.Z_SYNC_FLUSH })
  const b = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), i = info(b)
  save(name, trim(b, i.le, TARGET))
}
// BL3: tramo de bigFlows lejos del prefijo de desarrollo, resincronizado al primer límite de paquete válido
{
  const name = "BL3_bigFlows_seg200MB.pcap"
  if (existsSync(`${DIR}/${name}`)) console.log(`ya existe ${name}`)
  else {
    curl("https://s3.amazonaws.com/tcpreplay-pcap-files/bigFlows.pcap", `${DIR}/_hdr.bin`, "0-23"); curl("https://s3.amazonaws.com/tcpreplay-pcap-files/bigFlows.pcap", `${DIR}/_seg.bin`, "200000000-224100000")
    const h = new Uint8Array(readFileSync(`${DIR}/_hdr.bin`)), seg = new Uint8Array(readFileSync(`${DIR}/_seg.bin`)), i = info(h), dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength)
    let start = -1
    for (let k = 0; k < 4000 && start < 0; k++) {   // 6 registros encadenados con longitudes y marcas de tiempo plausibles
      let p = k, ok = true, t0 = -1
      for (let r = 0; r < 6 && ok; r++) {
        if (p + 16 > seg.length) { ok = false; break }
        const sec = dv.getUint32(p, i.le), frac = dv.getUint32(p + 4, i.le), incl = dv.getUint32(p + 8, i.le), orig = dv.getUint32(p + 12, i.le)
        if (incl > 65535 || incl < 14 || orig < incl || frac >= 1e6 || (t0 >= 0 && (sec < t0 || sec > t0 + 5))) ok = false
        t0 = sec; p += 16 + incl
      }
      if (ok) start = k
    }
    if (start < 0) throw new Error("no se pudo resincronizar BL3")
    const body = seg.subarray(start), file = new Uint8Array(24 + body.length); file.set(h, 0); file.set(body, 24)
    console.log(`BL3 resincronizado en el desplazamiento ${start} del tramo`); save(name, trim(file, i.le, TARGET))
  }
}
