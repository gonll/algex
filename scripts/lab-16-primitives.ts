// Mide el coste real (ns) de cada primitiva del motor para fijar las constantes del contador de trabajo.
import { makeComposed } from "../src/lab/hidden-compose"
import { makeHidden } from "../src/lab/hidden-gen"
import { leafGf2, leafPoly, leafBeatty, leafAnf, leafPeriodic, peelEnumerated, baffLift, idxLiftPoly, idxQuotient, dbg, dbgI } from "../src/lab/compose"
const time = <T,>(f: () => T, reps = 3): [number, T] => { let best = Infinity, r!: T; for (let i = 0; i < reps; i++) { const t = performance.now(); r = f(); best = Math.min(best, performance.now() - t) } return [best, r] }
const nsPer = (ms: number, n: number) => ((ms * 1e6) / n).toFixed(1)
for (const N of [256, 4096, 65536]) {
  const y = makeHidden("H", 1).train(N)
  const [ms] = time(() => { leafPoly(y); leafGf2(y); leafBeatty(y); leafAnf(y); leafPeriodic(y) })
  console.log(`hojas (5 solvers) sobre aleatorio N=${N}: ${ms.toFixed(2)} ms = ${nsPer(ms, N)} ns/elemento`)
}
for (const N of [256, 65536]) {
  const y = makeComposed("B1", 4001).train(N)
  const [ms, c] = time(() => peelEnumerated(y), 1)
  console.log(`peelEnumerated N=${N}: ${ms.toFixed(1)} ms, candidatos=${c.length}`)
}
{
  const y = makeComposed("B1", 4001).train(256)
  const [ms, c] = time(() => baffLift(y), 3); console.log(`baffLift(B1,N=256): ${ms.toFixed(1)} ms, nodos=${dbg.nodes}, candidatos=${c.length}, ${nsPer(ms, Math.max(1, dbg.nodes))} ns/nodo`)
  const yr = makeHidden("R", 1).train(256)
  const [ms2] = time(() => baffLift(yr), 3); console.log(`baffLift(aleatorio,N=256): ${ms2.toFixed(1)} ms, nodos=${dbg.nodes}`)
}
{
  const z = makeHidden("R", 2).train(256)
  const [ms] = time(() => idxLiftPoly(z, 20000), 1)
  console.log(`idxLiftPoly(aleatorio 256, cap 20000 nodos): ${ms.toFixed(0)} ms, estados=${dbgI.states}, nodos=${dbgI.nodes}  => ${nsPer(ms, Math.max(1, dbgI.states))} ns/estado (incluye sus nodos)`)
  const z2 = makeComposed("B1", 4001).train(256)
  const [ms3] = time(() => idxLiftPoly(z2, 20000), 1)
  console.log(`idxLiftPoly(B1 256, cap 20000): ${ms3.toFixed(0)} ms, estados=${dbgI.states}, nodos=${dbgI.nodes}`)
}
{
  const y = makeComposed("B4", 4001).train(1 << 16)
  const [ms, c] = time(() => idxQuotient(y), 3); console.log(`idxQuotient N=65536: ${ms.toFixed(1)} ms (${c.length} cand.)`)
}
