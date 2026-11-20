# Changelog

Sigue [Keep a Changelog](https://keepachangelog.com/) y [SemVer](https://semver.org/lang/es/). Mientras la versión sea 0.x, un cambio de formato que impide a versiones anteriores leer archivos nuevos se publica como *minor*.

## [0.2.0] — sin publicar

### Añadido
- **PAD6** (`kind=11`, `bit-lfsr`): LFSR sobre GF(2) a nivel bit con residual de posiciones Rice. Se emite solo si algún chunk lo usa; si no, la salida es byte-idéntica a PAD4/PAD5. Desactivable con `enableBitLfsr: false` en el `SearchBudget`.
- **Wrapper del original** (marcadores `0xb3` = brotli-11, `0xb4` = zstd/gzip en modo `fast`): cuando el PAD no aporta, se comprime el archivo original directamente (paridad con brotli-11 + 1 byte).
- Scripts `typecheck` y `typecheck:lab`; tests de compatibilidad con archivos de la versión anterior (`test/fixtures/legacy-archives`).

### Corregido
- **Addon nativo (`c/addon.c`)**: `bm16Solve` devolvía `coeffs` vacío cuando el orden era exactamente `BM16_MAX_L = 32` (comparación `<` en lugar de `<=`). Con el arreglo, un LFSR16 real de orden 32 se detecta y comprime (p. ej. xorshift32: 4096 B → 131 B). Las salidas solo cambian para entradas que son realmente LFSR de orden 32.
- **`RangeError: offset is out of bounds`** en `compress` con chunks cuyo orden LFSR16 llegaba a 32 (el encoder aceptaba un candidato sin coeficientes). El encoder ahora rechaza el candidato inconsistente aunque el binario nativo sea antiguo.
- **Paquete npm**: el addon no se encontraba al instalar (`dist/src/native/addon.js` buscaba `../../build/Release`, que desde `dist/` no es la raíz del paquete). Ahora prueba también `../../../build/Release`.
- **Entradas pequeñas**: ya no pueden quedar peor que brotli-11 + 1 byte (antes, p. ej., `fixup.dat` de 7 KB salía 51 % mayor y `STP_UplinkFast.pcapng` 43 %); por debajo de 1 MiB el original siempre compite.
- **Build**: `tsc` ya no compila `src/lab` ni los `*.test.ts`; dejan de publicarse. El tarball también excluye binarios de compilación de Windows (`.node`, `.o`, `gf-analyze*`): 394 kB / 153 archivos → ~113 kB / 80.

### Compatibilidad
- Esta versión lee todo lo que escribieron 0.1.x (PAD3/PAD4/PAD5, brotli/zstd/gzip, 87 archivos de referencia verificados).
- Las versiones 0.1.x **no** leen los archivos con PAD6 ni con marcadores `0xb3/0xb4` (error `Bad magic` o decodificación inválida).

### Límites conocidos
- En datos reales no algebraicos (PCAP, firmware, imágenes, CSV/JSON numéricos) Algex no mejora a brotli-11: paridad en el mejor caso y más lento. Ver `docs/research/01-audit-and-first-experiments.md` §19–22.
- El código de investigación (`src/lab`, `scripts/lab-*`) no forma parte del paquete ni del encoder.
