import { describe, it, expect } from "vitest"
import { computeSyndromes, decodeSyndromes, syndromeWireSize } from "./syndrome-residual"

describe("syndrome-residual prototype: correctness", () => {
  it("recovers a single error", () => {
    const positions = [10]
    const values = [0xab]
    const twoT = 4  // covers up to t=2 errors
    const syndromes = computeSyndromes(positions, values, twoT)
    const decoded = decodeSyndromes(syndromes, 64)
    expect(decoded).toEqual([{ position: 10, value: 0xab }])
  })

  it("recovers two errors", () => {
    const positions = [3, 40]
    const values = [0x11, 0x22]
    const twoT = 6
    const syndromes = computeSyndromes(positions, values, twoT)
    const decoded = decodeSyndromes(syndromes, 64)
    expect(decoded).toEqual([
      { position: 3, value: 0x11 },
      { position: 40, value: 0x22 },
    ])
  })

  it("recovers zero errors", () => {
    const syndromes = computeSyndromes([], [], 4)
    expect(decodeSyndromes(syndromes, 64)).toEqual([])
  })

  it("recovers several scattered errors within one 255-byte block", () => {
    const positions = [0, 17, 50, 100, 200, 254]
    const values = [1, 2, 3, 4, 5, 6]
    const twoT = 12  // covers up to t=6
    const syndromes = computeSyndromes(positions, values, twoT)
    const decoded = decodeSyndromes(syndromes, 255)
    expect(decoded).toEqual(positions.map((p, i) => ({ position: p, value: values[i] })))
  })

  it("fails safely (returns null) when twoT is too small for the actual error count", () => {
    const positions = [1, 2, 3, 4, 5]  // 5 errors
    const values = [1, 2, 3, 4, 5]
    const twoT = 4  // only covers t=2 — insufficient
    const syndromes = computeSyndromes(positions, values, twoT)
    const decoded = decodeSyndromes(syndromes, 64)
    expect(decoded).toBeNull()
  })

  it("syndromeWireSize matches the actual syndrome array length plus header", () => {
    expect(syndromeWireSize(6)).toBe(8)
  })
})
