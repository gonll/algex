// Núcleo: LFSR sobre GF(2) a nivel BIT (Berlekamp–Massey bit a bit), con variante de ruido aditivo
// (votación de ventanas + residual de posiciones) y puertas baratas de rechazo.
// Validado en docs/research/01-audit-and-first-experiments.md (experimentos 01-04).
// s[i] = XOR_{j=1..L} c_j & s[i-j]

export const gammaBits = (x: number): number => 2 * Math.floor(Math.log2(x + 1)) + 1

export const bytesToBits = (b: Uint8Array, msbFirst: boolean): Uint8Array => {
  const out = new Uint8Array(b.length * 8)
  for (let i = 0; i < b.length; i++) {
    const v = b[i]!
    for (let k = 0; k < 8; k++) out[i * 8 + k] = msbFirst ? (v >> (7 - k)) & 1 : (v >> k) & 1
  }
  return out
}

export const bitsToBytes = (bits: Uint8Array, msbFirst: boolean): Uint8Array => {
  const out = new Uint8Array(Math.ceil(bits.length / 8))
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[i >> 3]! |= msbFirst ? 1 << (7 - (i & 7)) : 1 << (i & 7)
  }
  return out
}



export interface Lfsr2 { n: number; L: number; c: Uint8Array /* c[1..L] */; seed: Uint8Array }

/**
 * BM sobre GF(2). Devuelve null si la complejidad lineal supera maxL (aborta temprano).
 * Buffers acotados por maxL y rotados (sin alocar por paso): el aborto se decide ANTES de tocar C,
 * así ningún índice supera maxL+1.
 */
export const synthLfsr2 = (s: Uint8Array, maxL: number): Lfsr2 | null => {
  const n = s.length
  const cap = Math.min(n, maxL) + 2
  const C = new Uint8Array(cap); C[0] = 1
  let B = new Uint8Array(cap); B[0] = 1
  let spare = new Uint8Array(cap)
  let L = 0, Lb = 0, m = 1
  for (let i = 0; i < n; i++) {
    let d = s[i]!
    for (let j = 1; j <= L; j++) d ^= C[j]! & s[i - j]!
    if (d === 0) { m++; continue }
    if (2 * L <= i) {
      const newL = i + 1 - L
      if (newL > maxL) return null
      spare.set(C.subarray(0, L + 1))
      for (let j = 0; j <= Lb; j++) C[j + m]! ^= B[j]!
      const t = B; B = spare; spare = t
      Lb = L; L = newL; m = 1
    } else {
      for (let j = 0; j <= Lb; j++) C[j + m]! ^= B[j]!
      m++
    }
  }
  return { n, L, c: C.slice(0, L + 1), seed: s.slice(0, Math.min(L, n)) }
}

export const genLfsr2 = (m: Lfsr2): Uint8Array => {
  const out = new Uint8Array(m.n)
  for (let i = 0; i < m.n; i++) {
    if (i < m.L) { out[i] = m.seed[i]!; continue }
    let v = 0
    for (let j = 1; j <= m.L; j++) v ^= m.c[j]! & out[i - j]!
    out[i] = v
  }
  return out
}

export const costLfsr2 = (m: Lfsr2): number => gammaBits(m.n) + gammaBits(m.L) + 2 * m.L

// LFSR sobre GF(2) con ruido aditivo en la SALIDA (bits flipados), recuperada por votación de
// ventanas + residual de posiciones. Modelo generativo: s = gen(modelo, ventana limpia) XOR r,
// con r disperso. Se paga: modelo + semilla + posiciones de r (gaps con Elias-gamma).
// Es la "Fase 5" del roadmap en su forma mínima: aproximación + corrección exacta.


export interface NoisyLfsr2 {
  n: number; L: number; c: Uint8Array; anchor: number; seed: Uint8Array
  errors: number[] // posiciones donde s != generado
}

export const genFromAnchor = (n: number, L: number, c: Uint8Array, anchor: number, seed: Uint8Array): Uint8Array | null => {
  if (c[L] !== 1 && anchor > 0) return null // extender hacia atrás exige c_L = 1
  const out = new Uint8Array(n)
  for (let i = 0; i < L; i++) out[anchor + i] = seed[i]!
  for (let i = anchor + L; i < n; i++) { let v = 0; for (let j = 1; j <= L; j++) v ^= c[j]! & out[i - j]!; out[i] = v }
  for (let i = anchor - 1; i >= 0; i--) {
    // s[i+L] = XOR_{j=1..L} c_j s[i+L-j]  =>  s[i] = s[i+L] ^ XOR_{j=1..L-1} c_j s[i+L-j]   (c_L = 1)
    let v = out[i + L]!
    for (let j = 1; j < L; j++) v ^= c[j]! & out[i + L - j]!
    out[i] = v
  }
  return out
}

export const costNoisyLfsr2 = (m: NoisyLfsr2): number => {
  const head = gammaBits(m.n) + gammaBits(m.L) + 2 * m.L + gammaBits(m.anchor) + gammaBits(m.errors.length) + 5 /* k de Rice */
  // Posiciones como gaps con código Rice(k); se elige el k que minimiza el costo real.
  const gaps: number[] = []
  let prev = -1
  for (const e of m.errors) { gaps.push(e - prev - 1); prev = e }
  let best = Infinity
  for (let k = 0; k < 24; k++) {
    let b = 0
    for (const g of gaps) b += k + 1 + Math.floor(g / 2 ** k)
    if (b < best) best = b
  }
  return head + (gaps.length ? best : 0)
}

export const genNoisyLfsr2 = (m: NoisyLfsr2): Uint8Array => {
  const out = genFromAnchor(m.n, m.L, m.c, m.anchor, m.seed)!
  for (const e of m.errors) out[e]! ^= 1
  return out
}

/**
 * @param window  longitud de ventana para BM local (debe ser >= 4·Lmax aprox.)
 * @param samples cuántas ventanas muestrear
 */
export const synthNoisyLfsr2 = (s: Uint8Array, maxL: number): NoisyLfsr2 | null => {
  // Ventanas adaptativas: de la más larga (barata, robusta) a la más corta (sobrevive a más ruido).
  let best: NoisyLfsr2 | null = null
  for (const [window, samples] of [[512, 48], [192, 200], [128, 400]] as const) {
    const m = synthWithWindow(s, maxL, window, samples)
    if (m && (!best || costNoisyLfsr2(m) < costNoisyLfsr2(best))) best = m
    // Si ya hay un ajuste que cuesta < 1/4 del crudo, no se gasta más búsqueda.
    if (best && costNoisyLfsr2(best) < s.length / 4) break
  }
  return best
}

const synthWithWindow = (s: Uint8Array, maxL: number, window: number, samples: number): NoisyLfsr2 | null => {
  const n = s.length
  if (n < window * 2) return null
  // 1) votar polinomios por ventanas
  const votes = new Map<string, { L: number; c: Uint8Array; anchors: number[] }>()
  for (let k = 0; k < samples; k++) {
    const p = Math.floor((k * (n - window)) / Math.max(1, samples - 1))
    const m = synthLfsr2(s.subarray(p, p + window), Math.min(maxL, window >> 2))
    if (!m || m.L === 0 || m.c[m.L] !== 1) continue
    const key = `${m.L}:${Array.from(m.c).join("")}`
    const e = votes.get(key)
    if (e) e.anchors.push(p); else votes.set(key, { L: m.L, c: m.c, anchors: [p] })
  }
  // 2) para los polinomios más votados, probar anclas y medir el costo real del residual
  const ranked = [...votes.values()].sort((a, b) => b.anchors.length - a.anchors.length).slice(0, 3)
  let best: NoisyLfsr2 | null = null, bestCost = Infinity
  for (const v of ranked) {
    if (v.anchors.length < 2) continue
    for (const anchor of v.anchors.slice(0, 6)) {
      const seed = s.slice(anchor, anchor + v.L)
      const g = genFromAnchor(n, v.L, v.c, anchor, seed)
      if (!g) continue
      const errors: number[] = []
      for (let i = 0; i < n; i++) if (g[i] !== s[i]) errors.push(i)
      const m: NoisyLfsr2 = { n, L: v.L, c: v.c, anchor, seed, errors }
      const cost = costNoisyLfsr2(m)
      if (cost < bestCost) { bestCost = cost; best = m }
    }
  }
  return best
}

/**
 * Puerta barata para el camino ruidoso: 64 ventanas de 128 bits, BM con maxL=40 (aborta a ~80 bits
 * en datos aleatorios). Pasa solo si el MISMO polinomio no trivial aparece en >= 2 ventanas
 * (dos ventanas independientes no coinciden por azar en un polinomio de grado <= 40).
 */
export const noisyGate = (s: Uint8Array, window = 128, samples = 64, maxL = 40): boolean => {
  const n = s.length
  if (n < window * 4) return false
  const seen = new Set<string>()
  for (let k = 0; k < samples; k++) {
    const p = Math.floor((k * (n - window)) / (samples - 1))
    const w = s.subarray(p, p + window)
    let c0 = 0; for (const b of w) c0 += b
    if (c0 === 0 || c0 === window) continue // ventana constante
    const m = synthLfsr2(w, maxL)
    if (!m || m.L === 0) continue
    const key = `${m.L}:${Array.from(m.c).join("")}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * Puerta exacta: BM sobre 4 ventanas de 1024 bits repartidas por la secuencia; pasa si alguna
 * ventana NO constante tiene complejidad lineal <= 128. Costo medido en datos reales: ~1 % del
 * tiempo de Algex por chunk (docs/research, experimento 03).
 */
export const exactGate = (bits: Uint8Array, W = 1024, gateL = 128): boolean => {
  if (bits.length < 4 * W) return false
  for (const f of [0, 0.33, 0.66, 1]) {
    const p = Math.round(f * (bits.length - W))
    let ones = 0
    for (let i = p; i < p + W; i++) ones += bits[i]!
    if (ones === 0 || ones === W) continue
    if (synthLfsr2(bits.subarray(p, p + W), gateL)) return true
  }
  return false
}


const windowBits = (chunk: Uint8Array, byteStart: number, nBytes: number, msbFirst: boolean): Uint8Array =>
  bytesToBits(chunk.subarray(byteStart, byteStart + nBytes), msbFirst)

const constant = (w: Uint8Array): boolean => { let o = 0; for (const b of w) o += b; return o === 0 || o === w.length }

/** exactGate sobre bytes: 3 ventanas de 64 bytes (512 bits), L <= 64. Sin convertir el chunk entero. */
export const exactGateBytes = (chunk: Uint8Array, msbFirst: boolean, windowBytes = 64, gateL = 64): boolean => {
  if (chunk.length < 4 * windowBytes) return false
  for (const f of [0, 0.5, 1]) {
    const p = Math.round(f * (chunk.length - windowBytes))
    const w = windowBits(chunk, p, windowBytes, msbFirst)
    if (constant(w)) continue
    if (synthLfsr2(w, gateL)) return true
  }
  return false
}

/** noisyGate sobre bytes: 16 ventanas de 12 bytes (96 bits) alineadas a byte, L <= 32; mismo criterio de coincidencia. */
export const noisyGateBytes = (chunk: Uint8Array, msbFirst: boolean, windowBytes = 12, samples = 16, maxL = 32): boolean => {
  if (chunk.length < windowBytes * 4) return false
  const seen = new Set<string>()
  for (let k = 0; k < samples; k++) {
    const p = Math.floor((k * (chunk.length - windowBytes)) / (samples - 1))
    const w = windowBits(chunk, p, windowBytes, msbFirst)
    if (constant(w)) continue
    const m = synthLfsr2(w, maxL)
    if (!m || m.L === 0) continue
    const key = `${m.L}:${m.c.join("")}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}
