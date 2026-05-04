// GF(p) arithmetic — all results are in [0, p)

export const mod = (a: bigint, p: bigint): bigint => ((a % p) + p) % p

// Modular inverse via extended Euclidean; p must be prime
export const modInv = (a: bigint, p: bigint): bigint => {
  let [r, nr] = [p, mod(a, p)]
  let [s, ns] = [0n, 1n]
  while (nr !== 0n) {
    const q = r / nr
    ;[r, nr] = [nr, r - q * nr]
    ;[s, ns] = [ns, s - q * ns]
  }
  return mod(s, p)
}

export const add = (a: bigint, b: bigint, p: bigint): bigint => mod(a + b, p)
export const sub = (a: bigint, b: bigint, p: bigint): bigint => mod(a - b, p)
export const mul = (a: bigint, b: bigint, p: bigint): bigint => mod(a * b, p)
export const div = (a: bigint, b: bigint, p: bigint): bigint => mul(a, modInv(b, p), p)
export const neg = (a: bigint, p: bigint): bigint => mod(-a, p)
