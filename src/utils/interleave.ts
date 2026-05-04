// Byte-lane interleave: split into m lanes and merge back.
// Lane j contains bytes x[j], x[j+m], x[j+2m], ...

export const splitInterleave = (x: Uint8Array, m: number): Uint8Array[] =>
  Array.from({ length: m }, (_, j) => {
    const len = Math.ceil((x.length - j) / m)
    const lane = new Uint8Array(Math.max(len, 0))
    for (let i = 0, k = j; k < x.length; i++, k += m) lane[i] = x[k]!
    return lane
  })

export const mergeInterleave = (lanes: Uint8Array[], m: number): Uint8Array => {
  const totalLen = lanes.reduce((s, l) => s + l.length, 0)
  const out = new Uint8Array(totalLen)
  for (let j = 0; j < m; j++) {
    const lane = lanes[j]!
    for (let i = 0; i < lane.length; i++) out[j + i * m] = lane[i]!
  }
  return out
}
