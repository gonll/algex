import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { createHash } from "crypto"
import { decompress } from "./index"

// Compatibilidad hacia atrás: archivos comprimidos por la versión ANTERIOR a la corrección del off-by-one de
// c/addon.c (LFSR16 de orden 32) y de tryLFSR16. Deben seguir decodificando exactamente (hash del original).
// Si se cambia el formato por error, este test lo detecta. No regenerar estos archivos: son la referencia.
const DIR = "test/fixtures/legacy-archives"
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as Record<string, { inSha: string; inLen: number }>

describe("compatibilidad: archivos comprimidos por la versión previa", () => {
  const files = readdirSync(DIR).filter(f => f.endsWith(".bin"))
  it("el corpus de referencia no está vacío y coincide con el manifiesto", () => {
    expect(files.length).toBeGreaterThanOrEqual(15)
    expect(files.sort()).toEqual(Object.keys(manifest).sort())
  })
  it.each(files)("%s se descomprime a los bytes originales", (f) => {
    const out = decompress(new Uint8Array(readFileSync(`${DIR}/${f}`)))
    expect(out.length).toBe(manifest[f]!.inLen)
    expect(createHash("sha256").update(out).digest("hex")).toBe(manifest[f]!.inSha)
  })
})
