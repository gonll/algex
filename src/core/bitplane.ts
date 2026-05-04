// Bit-plane decomposition: split a byte sequence into 8 independent binary planes.
//
// Plane b (0=LSB, 7=MSB) contains bit b of each input byte stored as a 0/1 byte.
// Each plane can be encoded independently with the standard LFSR pipeline; if the
// sum of 8 plane encodings beats the original raw size, the bitplane form wins.
//
// Useful when different bit-planes carry different linear structures — e.g.:
//   • ADC/DAC samples: MSB planes carry sign/magnitude patterns, LSBs are noisier
//   • Firmware code:   opcode MSBs may be periodic while operand LSBs are random

export const splitBitplanes = (x: Uint8Array): Uint8Array[] =>
  Array.from({ length: 8 }, (_, b) => {
    const plane = new Uint8Array(x.length)
    for (let i = 0; i < x.length; i++) plane[i] = (x[i]! >> b) & 1
    return plane
  })

export const mergeBitplanes = (planes: Uint8Array[]): Uint8Array => {
  const n = planes[0]!.length
  const out = new Uint8Array(n)
  for (let b = 0; b < 8; b++) {
    const plane = planes[b]!
    for (let i = 0; i < n; i++) out[i] |= (plane[i]! & 1) << b
  }
  return out
}
