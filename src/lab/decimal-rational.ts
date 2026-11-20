// Generador numérico: dígitos decimales de una fracción racional p/q (0 <= p/q < 1).
// Reconstrucción racional exacta = fracción más simple (fracciones continuas) dentro del
// intervalo [N/10^n, (N+1)/10^n) que determinan los n dígitos. Se verifica regenerando.
// Costo: gamma(n) + gamma(bits p) + gamma(bits q) + bits p + bits q.

import { bitLen, gammaBits } from "./bits"

export interface DecRat { n: number; p: bigint; q: bigint }

// Fracción más simple en el intervalo CERRADO [an/ad, bn/bd]
const simplest = (an: bigint, ad: bigint, bn: bigint, bd: bigint): [bigint, bigint] => {
  const quotients: bigint[] = []
  for (;;) {
    const fl = an / ad
    if (fl * ad === an) { quotients.push(fl); break }            // a es entero
    if ((fl + 1n) * bd <= bn) { quotients.push(fl + 1n); break } // fl+1 cabe en el intervalo
    quotients.push(fl)
    ;[an, ad, bn, bd] = [bd, bn - fl * bd, ad, an - fl * ad]
  }
  let p = quotients[quotients.length - 1]!, q = 1n
  for (let i = quotients.length - 2; i >= 0; i--) {
    ;[p, q] = [quotients[i]! * p + q, p]
  }
  return [p, q]
}

export const genDecRat = (m: DecRat): Uint8Array => {
  const N = ((m.p % m.q) * 10n ** BigInt(m.n)) / m.q
  const s = N.toString().padStart(m.n, "0")
  const out = new Uint8Array(m.n)
  for (let i = 0; i < m.n; i++) out[i] = s.charCodeAt(i)
  return out
}

/** `digits`: bytes ASCII '0'..'9' (los decimales tras "0."). null si no es todo dígitos. */
export const synthDecRat = (digits: Uint8Array): DecRat | null => {
  const n = digits.length
  if (n < 16) return null
  let s = ""
  for (const b of digits) { if (b < 48 || b > 57) return null; s += String.fromCharCode(b) }
  const N = BigInt(s), T = 10n ** BigInt(n)
  // cerrado [N/T, ((N+1)T-1)/(T*T)·T ...] — cota superior estricta aproximada: (N+1)/T - 1/T^2
  const [p, q] = simplest(N, T, (N + 1n) * T - 1n, T * T)
  const m: DecRat = { n, p, q }
  const back = genDecRat(m)
  for (let i = 0; i < n; i++) if (back[i] !== digits[i]) return null
  return m
}

export const costDecRat = (m: DecRat): number =>
  gammaBits(m.n) + gammaBits(bitLen(m.p)) + gammaBits(bitLen(m.q)) + bitLen(m.p) + bitLen(m.q)

/** Igual que en fcsr.ts: síntesis sobre prefijos de dígitos crecientes + verificación completa. */
export const synthDecRatProgressive = (digits: Uint8Array, maxPrefix = 4096): DecRat | null => {
  const n = digits.length
  for (let k = 64; ; k *= 2) {
    const kk = Math.min(k, n, maxPrefix)
    const m = synthDecRat(digits.subarray(0, kk))
    if (m) {
      const full: DecRat = { n, p: m.p, q: m.q }
      const back = genDecRat(full)
      let ok = true
      for (let i = 0; i < n; i++) if (back[i] !== digits[i]) { ok = false; break }
      if (ok) return full
    }
    if (kk >= n || kk >= maxPrefix) return null
  }
}
