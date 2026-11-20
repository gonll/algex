// Experimento 10 — Etapa 2: ¿puede un motor composicional descubrir composiciones desconocidas?
//   npx tsx scripts/lab-11-compose.ts <lote A|B|X> <instancias por clase> <log2 N> [ms por instancia]
// X = las clases X1/X2 del experimento 09 (referencia). Tres métricas separadas por instancia:
//   DESCUBRIMIENTO: reproduce el entrenamiento Y acierta TODOS los índices de [N, 2^20)
//   COMPRESIÓN:     reproduce el entrenamiento con costo < 25 % de min(brotli-11, crudo) (representación aceptada)
//   (sobreajuste = comprime pero no descubre; fallo = ninguna representación aceptada)
// GENERALIDAD: tasa de descubrimiento por grupo de clases (peelers diseñados vs composiciones no usadas al diseñar).
import * as zlib from "zlib"
import { createHash } from "crypto"
import { readFileSync } from "fs"
import { makeComposed, CLASSES, LOTE_A, LOTE_B, ClassId } from "../src/lab/hidden-compose"
import { makeHidden, FamilyId } from "../src/lab/hidden-gen"
import { discoverCompose } from "../src/lab/compose"
import { evalVec } from "../src/lab/ast"
import { discover } from "../src/lab/synth"

const batch = (process.argv[2] ?? "A").toUpperCase(), PER = Number(process.argv[3] ?? 10), N = 1 << Number(process.argv[4] ?? 16), MS = Number(process.argv[5] ?? 20000)
const GREEDY = process.argv[6] === "nogreedy" ? 0 : process.argv[6]?.startsWith("greedy=") ? Number(process.argv[6].slice(7)) : undefined, ONLY = process.argv[7]?.split(",")
const FAR = 1 << 20, seedBase = batch === "B" ? 1000 : 0
const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8)
console.log(`Lote ${batch}: ${PER}/clase, N=${N}, presupuesto ${MS} ms, generalización en TODOS los índices de [N, 2^20). hashes compose=${hash("src/lab/compose.ts")} ast=${hash("src/lab/ast.ts")} probes=${hash("src/lab/probes.ts")}\n`)
const classes: string[] = (batch === "A" ? LOTE_A : batch === "B" ? LOTE_B : ["X1", "X2"]).filter((c) => !ONLY || ONLY.includes(c))
const med = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1]! : NaN
const brotli = (y: Uint8Array) => 8 * zlib.brotliCompressSync(y, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
console.log("clase | composición                         | congelado(09) desc | sin composición desc | MOTOR desc/sobreaj/fallo | costo mediano vs brotli (aceptadas) | ms med | rutas")
const tot = { desc: 0, sob: 0, fail: 0, n: 0 }
for (const cls of classes) {
  const t = { desc: 0, sob: 0, fail: 0 }; let frozen = 0, ablated = 0
  const costs: number[] = [], brs: number[] = [], ms: number[] = [], routes: Record<string, number> = {}, notes: string[] = []
  for (let k = 1; k <= PER; k++) {
    const hid = cls.startsWith("X") ? makeHidden(cls as FamilyId, seedBase + k) : makeComposed(cls as ClassId, seedBase + k)
    const y = hid.train(N)
    const bro = brotli(y), thr = 0.25 * Math.min(bro, 8 * N)
    const classify = (v: Uint8Array): "D" | "S" | "F" => {
      for (let n = 0; n < N; n++) if (v[n] !== y[n]) return "F"
      for (let n = N; n < FAR; n++) if (v[n] !== hid.eval(n)) return "S"
      return "D"
    }
    const d0 = discover(y)
    if (d0.rep) { d0.rep.prepare?.(FAR + 1); let ok = true; for (let n = 0; n < FAR && ok; n++) if (d0.rep.eval(n) !== (n < N ? y[n]! : hid.eval(n))) ok = false; if (ok) frozen++ }
    const ab = discoverCompose(y, { maxDepth: 3, ms: MS, peelers: ["delta", "il2"] })
    if (ab && ab.cost < thr && classify(evalVec(ab.node, FAR)) === "D") ablated++
    const r = discoverCompose(y, { maxDepth: 3, ms: MS, greedy: GREEDY })
    if (!r) { t.fail++; continue }
    ms.push(r.ms)
    const accepted = r.cost < thr
    const out = accepted ? classify(evalVec(r.node, FAR)) : "F"
    if (out === "D") t.desc++; else if (out === "S") { t.sob++; notes.push(`${cls}#${k} sobreajuste ${r.path.join(">")}`) } else t.fail++
    if (accepted) { costs.push(r.cost); brs.push(bro); const key = r.path.join(">").slice(0, 40); routes[key] = (routes[key] ?? 0) + 1 }
  }
  tot.desc += t.desc; tot.sob += t.sob; tot.fail += t.fail; tot.n += PER
  const rt = Object.entries(routes).map(([k, v]) => `${k}×${v}`).join(" ")
  const name = ((CLASSES as Record<string, string>)[cls] ?? "(exp. 09)").padEnd(35)
  console.log(`${cls.padEnd(5)} | ${name} | ${String(frozen).padStart(18)} | ${String(ablated).padStart(20)} | ${`${t.desc}/${t.sob}/${t.fail}`.padStart(24)} | ${costs.length ? `${med(costs).toFixed(0)} vs ${med(brs).toFixed(0)}`.padStart(35) : "—".padStart(35)} | ${med(ms).toFixed(0).padStart(6)} | ${rt}`)
  for (const l of notes) console.log("   · " + l)
}
console.log(`\nTOTAL: descubiertas ${tot.desc}/${tot.n}, sobreajustes ${tot.sob}, fallos ${tot.fail}`)
