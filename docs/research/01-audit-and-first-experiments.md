# Investigación 01 — Auditoría, laboratorio y primeros experimentos de búsqueda inversa

Fecha: 2026-11-18. Código: `src/lab/` (aislado; el encoder no depende de él), `scripts/lab-01-inverse.ts`, `scripts/lab-02-noisy-lfsr.ts`. Salidas crudas: `lab-01-raw.txt`, `lab-02-raw.txt` (primera versión, exacta con Elias-gamma), `lab-02b-raw.txt` (versión final).

## 1. Auditoría (Fase 0)

Línea base: 242 tests pasan antes de tocar nada; 253 con el laboratorio.

Qué hace Algex hoy: Berlekamp–Massey / Padé **sobre GF(2⁸) a nivel byte** (+ GF(2¹⁶)), LFSR aproximado L=1..5 por votación, cíclico exacto/aproximado, deltas, interleave, bit-planes (planos de bit codificados *como bytes 0/1*), residuales dispersos (7 formatos + deflate/brotli), diccionario de modelos LFSR, chunking por entropía y por modelo, envoltura final brotli/zstd. Todo contabilizado en bytes serializados reales con CRC. Decoder determinista.

Mapa contra el roadmap del documento:

| Roadmap | Estado en Algex |
|---|---|
| BM, LFSR, residual XOR, diccionario de modelos, chunks variables, selección por costo real | Implementado (solo GF(2⁸)) |
| BM **sobre GF(2)** (bit a bit), generadores de acceso directo f(n) | **No existe** |
| FCSR / expansión 2-ádica de p/q, fracciones continuas, PSLQ | **No existe** |
| Recurrencias no lineales | Prototipo `experimental/`, sin hits |
| Candidatos solapados + optimización global (DP/MDL) | Solo heurísticas locales por chunk |
| Costo de decoder / arithmetic coding / ANS | ANS evaluado y rechazado en README |
| Funciones trascendentes, regresión simbólica | No existe |

**Debilidad concreta detectada.** Para un PRBS bit-serial empaquetado en bytes, GF(2⁸) ve un LFSR de orden ≈ el del polinomio *en bytes* (README: PRBS31 → orden 31 sobre GF(2⁸)) y paga 42 %. El generador real es de 31 *bits*.

## 2. Experimento 01 — generadores binarios y numéricos

Tres sintetizadores, todos con reconstrucción verificada bit a bit y costo en bits efectivos (códigos Elias-gamma para longitudes):

1. **LFSR/GF(2)**: BM bit a bit (`lfsr2.ts`). Costo = γ(n)+γ(L)+2L bits.
2. **FCSR 2-ádico**: expansión de p/q con q impar. Se sintetiza por reducción de retículo de Lagrange `{(f,g): f ≡ g·A mod 2ⁿ}` (equivalente a Klapper–Goresky), sobre prefijos crecientes y verificando contra la secuencia completa (`fcsr.ts`). Costo ≈ 2·log₂ q bits.
3. **Racional decimal**: dígitos ASCII de p/q; fracción más simple del intervalo por fracciones continuas (`decimal-rational.ts`).

Resultados (n = 32 KiB; bytes totales serializados, incluido 1 byte de tag; **sintético**):

| Entrada | Mejor método lab | Algex actual | brotli-11 | zstd-19 |
|---|---|---|---|---|
| PRBS7 | 9 B (LFSR) | 60 | 144 | 147 |
| PRBS15 | 11 B | 3 545 | 32 772 | 32 778 |
| PRBS23 | 13 B | 16 754 | 32 772 | 32 778 |
| PRBS31 | 15 B | 24 795 | 32 772 | 32 778 |
| LFSR grado 64 aleatorio | 24 B | 32 929 | 32 772 | 32 778 |
| FCSR q=24 / 64 / 256 bits | 14 / 25 / 74 B (FCSR) | 32 929 | 32 772 | 32 778 |
| decimales de 1/9973 (20 KB) | 8 B (racional) | 406 | 251 | 272 |
| decimales de 355/1000003 | 11 B | 8 864 | 8 505 | 8 483 |
| decimales de p/q, q de 120 bits | 37 B | 8 873 | 8 495 | 8 556 |

Controles (deben quedar sin compresión con estos métodos): aleatorio 32 KB, dígitos decimales aleatorios 20 KB → ningún método lab acepta, sin falsos positivos. **Reales** (README.md, `gf-analyze.exe`, primeros 32 KB de `node.exe`): ningún método lab aplica; Algex y brotli quedan como antes (brotli-11 gana por ~1–3 %). Es decir: estas familias no aportan nada en datos reales no generados por LFSR/racionales — el resultado esperado y reportado tal cual.

## 3. Experimento 02 — LFSR + ruido (Fase 5 mínima: modelo + residual exacto)

Modelo generativo desde una ventana limpia (hacia delante y atrás), votación de polinomios por ventanas adaptativas (512/192/128), residual = posiciones de bits flipados con gaps Rice(k óptimo). PRBS31, 32 KiB, 2 repeticiones por tasa:

| Ruido de bits | Modelo+residual | Cota Shannon H(p) | brotli-11 | Algex |
|---|---|---|---|---|
| 0 % | 16 B | 0 | 32 772 | 24 795 |
| 0,01 % | 63–75 B | 48 | 32 772 | ~32 8xx |
| 0,1 % | 393–402 B | 374 | 32 772 | ~32 8xx |
| 0,5 % | 1 473–1 523 B | 1 488 | 32 772 | ~32 8xx |
| 1 % | 2 610–2 663 B | 2 647 | 32 772 | ~32 8xx |
| 2 % | 4 614–4 680 B | 4 635 | 32 772 | ~32 9xx |
| ≥ 5 % | **falla** (no se halla ventana limpia) | 9 385 … 23 656 | 32 772 | — |

(Los valores bajo la cota en 0,5 % y 2 % son varianza de muestra: el residual real de esa semilla tuvo menos errores que el valor esperado.)

Historial: la primera versión (ventana única 512 + Elias-gamma) llegaba solo a 0,5 % y costaba ~1,5× la cota. Ventanas adaptativas llevaron el límite a 2 %; Rice llevó el costo a ~1 % de la cota.

## 4. Hallazgos y refutaciones

- **Positivo, verificado**: el cuello de botella para generadores binarios no era la teoría sino el *cuerpo base*. Pasar de GF(2⁸) por byte a GF(2) por bit baja PRBS31 de 75,7 % a 0,05 % (≈1 650×).
- **Positivo**: el análogo exacto de "fracción pequeña → miles de dígitos" existe en dos formas con costo ≈ 2·log q: decimal (fracciones continuas) y binaria con acarreo (FCSR). Brotli no ve ninguna de las dos (≥ 8 KB en los racionales decimales con período largo).
- **Negativo / límite**: nada de lo anterior comprime datos reales no generados por esas estructuras (tres archivos reales: 0 aceptaciones, 0 falsos positivos). Estos métodos son un *especialista*, no un compresor general.
- **Negativo / límite**: la recuperación por ventanas muere cuando no existe ninguna ventana libre de ruido (≈ ≥ 5 % para L=31). Más allá hace falta decodificación estadística (ataques de correlación rápida / aprendizaje de paridad con ruido), no BM.
- **Hallazgo colateral**: cada bit de un `xorshift32` es una LFSR de grado 32 sobre GF(2); el laboratorio lo detectó como "estructura" en lo que yo creía ruido (L=32). Para corpus se usa mulberry32. Lección: los controles aleatorios deben venir de un generador no lineal; también sugiere el uso defensivo (detector de PRNG débiles).
- **Costo**: FCSR es el método lento cuando falla (≈ 20 s con prefijo 32 K; reducido con `maxPrefix = 8192`, no re-medido en esta sesión). BM bit a bit: 0,07–0,5 s por 262 144 bits para L ≤ 64.
- **Sesgo a vigilar**: todo el corpus sintético fue construido *con* estas estructuras, así que las tasas de ahorro son techo, no expectativa. El valor del resultado está en (a) exactitud, (b) ausencia de falsos positivos en controles y datos reales, (c) cercanía a la cota teórica.

## 5. Criterios de aceptación para integrar al encoder (Fase 6)

Aún **no integrado**. Para integrar un candidato "bit-LFSR/FCSR/racional" como `kind` nuevo en el formato: (1) reconstrucción exacta + CRC; (2) puerta barata de rechazo (BM bit con `maxL` pequeño y abortar) con costo < ~5 % del tiempo actual en datos no algebraicos — **pendiente de medir**; (3) ahorro neto sobre brotli/zstd/Algex en el corpus de `scripts/bench-real-world.ts` sin pérdida en datos reales; (4) versión de formato (PAD6) sin romper PAD4/5.

## 6. Qué investigar después (en orden)

1. **Medir la puerta de rechazo** en el corpus real (firmware, pcap) y el costo en tiempo del BM bit sobre chunks; sin esto no se integra (criterio 2).
2. **Acceso directo f(n)**: pruebas de bits de funciones sencillas (cuadráticos mod p, Legendre, Thue–Morse, bit n de √2/π) frente a LFSR; tamaño de expresión vs. LFSR equivalente (sección 4 del documento, aún sin experimento).
3. **Segmentación MDL** con candidatos solapados: DP sobre ventanas con el costo en bits ya definido aquí (Fase 7).
4. **Ruido alto** (> 5 %): evaluar decodificación por correlación para polinomios de pocos taps.
5. Estado del arte pendiente de revisar por fuente (no se consultó literatura en esta sesión; los algoritmos usados —BM, Klapper–Goresky, fracciones continuas— son clásicos y se implementaron desde su definición).

## 7. Experimento 03 — puerta de rechazo sobre datos reales (`scripts/lab-03-gate.ts`, `lab-03-raw.txt`)

Corpus: `test/real-data` (firmware RPi, jpg, pcap, 7 PRBS ITU-T reales). Chunks de 32 KiB. Puerta = BM/GF(2) sobre 4 ventanas de 1024 bits, ambos órdenes de bit, pasa si alguna tiene L ≤ 128.

| Medida | Resultado |
|---|---|
| Costo de la puerta | 0,6–2,3 ms/chunk (media 1,47) vs Algex ≈ 118 ms/chunk (muestra) → **≈ 0,7–2 %** (criterio: < 5 %) ✓ |
| Verdaderos positivos (PRBS 7/9/11/15/20/23/31 reales) | **28/28 chunks** pasan y se aceptan con reconstrucción exacta |
| Falsos pasos en datos no algebraicos | 10 de 427 chunks (2,3 %): bootcode.bin 2/2, start.elf 8/93 |
| Falsos positivos tras la síntesis completa (ahorro ≥ 10 % y exacto) | **0 de 427** |
| Camino ruidoso sin puerta | 16–390 ms/chunk: a menudo **más caro que Algex entero**. Inviable sin puerta |

Notas y salvedades:
- Los 10 falsos pasos son probablemente ventanas de relleno de ceros (L=0), ya cubiertas por Algex; **no verificado**. Barato de descartar: exigir L ≥ 1 o ventana no constante.
- El script marcó `fixup.dat` como aceptado por el camino ruidoso: **error de criterio mío** (comparaba contra 90 % del crudo, no contra las alternativas). El ajuste real es L=7 con 5 822 errores (~10 % de los bits), 3 450 B, contra 1 880 B de Algex y 1 246 B de brotli-11. Con el criterio correcto (costo < mejor alternativa) pierde. Corrección pendiente en el script.
- Cobertura incompleta: 3 pcap (< 4 KiB o < 4 ventanas) no se midieron; el corpus real no contiene ningún caso de LFSR + ruido real, así que el camino ruidoso solo está validado en sintético.

**Veredicto.** La puerta exacta cumple el criterio 2 de aceptación (§5): costo marginal ≈ 1 %, sin falsos positivos finales, todos los PRBS reales detectados. El camino ruidoso **no** está listo: necesita su propia puerta (p. ej. exigir que la puerta exacta vea ≥ 1 ventana con L pequeño *y* repetido en ≥ 2 ventanas) y el criterio "gana a la mejor alternativa".

## 8. Siguiente

1. Corregir el criterio de aceptación del script 03 (comparar con Algex/brotli) y excluir ventanas constantes de la puerta; re-medir.
2. Medir el beneficio **incremental** sobre Algex+wrapper en el corpus real de PRBS (hoy Algex ya saca ~42 % ahí; el lab daría < 0,1 %), y confirmar con `compress()` que el candidato nuevo no degrada el resto.
3. Diseñar `kind` nuevo (PAD6) con LFSR-GF(2) y probar roundtrip + CRC; recién ahí integrar.

## 9. Integración al encoder (Fase 6): `bit-lfsr`, kind 11, formato PAD6

**Qué se integró.** `src/core/bit-lfsr.ts` (BM sobre GF(2), variante con ruido, puertas), `BitLfsrChunk` en `types.ts`, kind 11 en `format.ts`/`decoder.ts`, candidato en `encodeChunk`, fusión de bit-lfsr exactos consecutivos en `mergeCompatibleChunks`, campo `enableBitLfsr` en `SearchBudget` (true en fast/balanced/max). Compatibilidad: un archivo usa magic `PAD6` **solo** si contiene un chunk bit-lfsr; si no, sale PAD4/PAD5 con el mismo tamaño que antes (verificado en 1,9–2,5 MB de datos reales no algebraicos). Un decoder anterior no lee PAD6 (esperable). 262 tests pasan (9 nuevos: roundtrip, LSB/MSB, ruido, aleatorio, texto, XDNI y CRC).

**Resultado en los 7 PRBS ITU-T reales (128 KiB c/u), `compress()` completo:** Algex antes **224 142 B** → ahora **375 B** (≈ 600×); referencia del laboratorio con un solo modelo: 82 B. Todos reconstruyen exacto. Los ~50 B por archivo restantes son cabecera/índice XDNI/CRC/wrapper.

**Lo que salió mal en el camino (y se corrigió):**
1. Sin fusión de chunks, cada chunk de ≤ 4 KB (el pipeline parte en `MAX_CHUNK = 4096`) pagaba su cabecera: **prbs7 empeoró 59 → 296 B**. Arreglado con fusión por continuidad de estado (→ 51 B).
2. Un "ajuste" L=16 con **33 % de bits en error** ganaba por 5 % a raw antes del wrapper y luego perdía contra brotli sobre raw: **start.elf +691 B**. Regla de aceptación: el candidato solo entra si su estimación es ≤ 1/4 del crudo. Tamaño idéntico tras el cambio.
3. Mi medición del experimento 03 usó chunks de 32 KiB; con los de 4 KiB reales las puertas tienen costo fijo por chunk y la sobrecarga medida en A/B real fue **+33 %** (criterio: ~5 %). Se optimizó BM (sin alocaciones, buffers acotados por maxL), las puertas convierten solo sus ventanas, y se redimensionaron. Bug propio intermedio: reestructurar las puertas dejó de probar el camino ruidoso cuando la exacta pasaba por azar y su síntesis fallaba (lo atrapó un test).

**Costo final (`scripts/lab-05-gate-cost-ab.ts`, `lab-05-raw.txt`):** sobre firmware/jpg/pcap reales, `encode()` aislado: **+7 – 10 %**, tamaño idéntico; en `compress()` completo (A/B previo, 3 rondas) +3,2 / +5,0 / +7,9 %. **Está en el límite del criterio de ~5 %, no por debajo con holgura**; hay ruido de máquina de ±2 puntos. Si se necesita menos: desactivar en modo `fast` (`enableBitLfsr: false`) o reducir ventanas a costa de detección.

**Alcance de detección con las puertas finales (límites, no promesas):** exacta L ≤ 64 (3 ventanas de 512 bits por orden); ruidosa L ≤ 32 (16 ventanas de 96 bits; a ~2 % de ruido se espera detectar en ~2/3 de los chunks, ≥ 5 % no). Lo medido en 02 con ventanas largas ya no aplica tal cual a las puertas de producción; **falta re-barrer ruido a través del encoder real**.

**Pendiente:**
- Re-barrido de ruido (0–5 %) usando `compress()` con las puertas finales.
- Medir sobre PRBS con LFSR de L entre 32 y 64 y sobre LFSR+datos mezclados (segmentos intercalados con firmware), el caso donde la fusión y el chunking importan.
- Fusión de chunks ruidosos que comparten modelo (hoy solo los exactos).
- README: documentar PAD6 (no hecho todavía).


## 10. Cierre de PAD6 (experimento 06, `lab-06-raw.txt`; tests `src/codec/pad6.test.ts`)

Todo por el encoder real, 128 KiB por caso; "enc" = `serialize(encode())` (sin wrapper), "compress" = salida completa.

**Ruido de bits en PRBS31** (cota = H(p)·n/8): 0 % → 57 B; 0,1 % → 2 632 B (cota 1 495); 0,5 % → 7 218 (5 953); 1 % → 11 796 (10 590); **2 % → 61 725 B (cota 18 539): solo 20/32 chunks detectados**; 3 % → 10/32; **5 % → 0/32, sin ganancia**. Hasta ~1 % la salida queda a 1,1–1,8× la cota (el exceso es sobre todo cabecera por chunk: los chunks ruidosos no se fusionan). Límite honesto de las puertas de producción: ~1 % de ruido de forma fiable, ~2 % parcial.

**Grado de LFSR (denso, 128 KiB, exacto):** L = 32 / 40 / 48 / 64 → 57 / 59 / 61 / 65 B ✓. **L = 72 y 96 → no detectados** (0/32; la puerta exacta cubre L ≤ 64 por diseño). Con 0,5 % de ruido: L=32 ✓ (7 073 B), **L=48 ✗** (la puerta ruidosa cubre L ≤ 32).

**Mixto (PRBS31 | firmware | PRBS23+0,5 % | texto | LFSR48 | firmware | PRBS31):** `compress` 62 888 B contra brotli-11 153 978 B y encoder sin bit-lfsr 182 702 B. Inspección de chunks: los 4 segmentos sintéticos se detectan con fronteras alineadas a ~±10 B (PRBS31 de 32 KiB → 1 chunk de 18 B tras fusionar; PRBS23 ruidoso → 8 chunks de ~200 B); los reales quedan `raw`. Solo-datos-reales: `compress` 56 068 vs brotli 55 532 (en ese momento aún +1 % peor; ver §13).

**Compatibilidad (documentada, verificada con tests):** el lector entiende PAD3/4/5/6; un decoder anterior rechaza PAD6 ("Bad magic"). PAD6 solo se emite si hay un chunk bit-lfsr; sin él la salida es **byte-idéntica** a la del candidato apagado (test). PAD6 = layout PAD5 con tabla de modelos siempre presente (puede estar vacía), así que convive con el diccionario. Probado: archivo mixto, convivencia con diccionario de modelos, `readChunkAt`, `streamDeserialize`, CRC ante corrupción, roundtrip con residual.

## 11. Perfil real del sobrecosto (`profile-02-raw.txt`; sin modificar el algoritmo)

`node --cpu-prof` sobre el JS compilado, encode de 4 archivos reales no algebraicos × 2 pasadas, 11,4 s totales:

| Función | % CPU |
|---|---|
| `findApproxCyclic` (core/cyclic.ts, **preexistente**) | **29,9 %** |
| `runLFSR` (encoder.ts, **preexistente**; puente nativo + `Array.from`) | **16,6 %** |
| `scanModelBoundaries` (chunker) | 5,5 % |
| **`synthLfsr2` (bit-lfsr; bucle interno de BM de las puertas)** | **4,4 %** |
| `entropyChunks` | 4,0 % |
| `noisyGateBytes` + `exactGateBytes` + resto bit-lfsr | 2,5 % |

Todo el módulo bit-lfsr = **6,9 %** del CPU, consistente con el +5–8 % medido por A/B. Conclusión: lo que quede por reducir en bit-lfsr es BM bit a bit (empaquetar en palabras de 32 bits lo recortaría ~10× en esa función, ≈ 4 puntos del total, estimación no medida); los dos mayores consumidores del encoder (**≈ 46 %**) no tienen que ver con PAD6 y son mejores candidatos para optimizar aparte, verificando salida byte-idéntica. No se tocó nada más (recomendación: no gastar más aquí).

## 12. f(n): generadores de acceso directo (experimento 07, `lab-07b-raw.txt`; `src/lab/expr-search.ts`)

DSL con semántica de enteros de 32 bits sin signo, ops `+ - * ^ & | << >> % pc` y potencia modular `(e ** K mod M)`, enumeración ascendente con equivalencia observacional (96 puntos), constantes libres en la raíz, verificación exacta sobre TODOS los puntos. Costo = 4 bits/nodo + γ(constantes). **No incluye el intérprete del DSL** (costo de decoder fijo).

| Objetivo (sintético, de mi diseño) | f(n) hallada | bits f(n) | BM bit | brotli (bits) |
|---|---|---|---|---|
| (7n+3) mod 256 | `3 + n*7` | 32 | — | 1 984 |
| n² mod 256 | `n*n` | 12 | — | 1 160 |
| n xor (n>>3) | idem | 21 | — | 7 632 |
| (n²) mod 251 | `n ** 2 mod 251` | 26 | — | 2 184 |
| **Thue–Morse** (65 536 bits) | `pc(n)` | **8** | **no (L>2048)** | 544 |
| **Rudin–Shapiro** | `pc(n & (n<<1))` | 23 | **no (L>2048)** | 936 |
| bit 3 de n² | `(n*n)>>3` | 21 | L=6 / 50 bits | 104 |
| n³ mod 997 | `n ** 3 mod 997` | 32 | — | 8 224 |
| **Legendre mod 1009** | `n ** 504 mod 1009` | **44** | L=504 / **1 058** | 8 208 |
| (13n) xor (n>>2) | **no encontrada** (13 fuera de la rejilla de constantes) | — | — | 7 832 |
| ((40503n+12345)>>8) mod 256 | **no encontrada** (2 constantes grandes anidadas) | — | — | 3 616 |
| aleatorio / texto / binario real | **ninguna** (sin falsos positivos) | — | — | — |

Lectura: (1) donde el generador secuencial tiene complejidad lineal alta (Thue–Morse, Rudin–Shapiro, Legendre) la fórmula directa es **24–130× más corta que BM y 70–190× que brotli** (en los casos donde BM sí encuentra algo); las dos familias son complementarias, no sustitutas. (2) **Sesgo reconocido**: todos los objetivos salen de mi propia familia; solo demuestra que la búsqueda funciona. (3) **Falla real**: constantes grandes dentro de la expresión; la enumeración con rejilla no las resuelve y hace falta resolverlas analíticamente (p. ej. por diferencias finitas modulares o aritmética 2-ádica). (4) Costo ~3 s por objetivo con tamaño ≤ 7: **inviable por chunk sin una puerta previa** (misma lección que bit-lfsr).

## 13. Archivos cotidianos (experimento 08, `lab-08-raw.txt` y `lab-08b-raw.txt`)

Corpus real y no privado de esta máquina (código TS/JS, JSON, source maps, ejecutables, firmware, JPEG, pcap), hasta 1 MiB por categoría; detectores exactos sobre ventanas de 4 KiB: constante/cíclico, GF(2⁸) L≤16, bit-LFSR, polinomio mod 2^(8w) de grado ≤3 (w=1,2,4) y columnas con stride.

**Hallazgo 1 — cobertura matemática exacta en datos cotidianos: 0,0 %** en todas las categorías (excepciones: 0,7 % de ventanas constantes/cíclicas en firmware; 2,2 % de ventanas de ejecutables con ≥ 50 % de columnas polinómicas, que no llegan a explicar ≥ 90 %). El control positivo (PRBS reales) da 71,4 % por bit-LFSR y 28,6 % constantes/GF256 ⇒ los detectores funcionan y la ausencia es real. **Sobre archivos cotidianos, estas familias exactas no aportan nada.** Es el resultado que se pedía vigilar.

**Hallazgo 2 — regresión práctica encontrada y corregida.** Algex (antes) era **peor que brotli-11 en todas las categorías cotidianas**: +3,2 % código, +4,3 % JS, **+7,8 % JSON**, +4,0 % source maps, +2,0 % ejecutables, +1,4 % firmware, +0,3 % JPEG, +4,0 % pcap. Causa verificada en un JSON de 256 KiB: 64 chunks, todos `raw`; el PAD agrega 1 113 B de framing (CRC32 de 4 B + 8 B de índice XDNI por chunk, incompresibles) y brotli(PAD) = 57 341 B vs brotli(original) = 56 182 B. Corrección (`wrapFile`, marcadores `0xb3` brotli-11(original) y `0xb4` zstd/gzip(original) en modo fast): compite contra el original cuando < 25 % de los bytes están en chunks estructurados; con 0 % estructurado gana por construcción y además ahorra el brotli del PAD. Resultado: **paridad con brotli-11 (+1 byte) en las 8 categorías**; PRBS sin cambios (212 B); 279 tests pasan (7 nuevos). Compatibilidad: archivos viejos siguen decodificando; los nuevos con marcador 0xb3/0xb4 no los lee un decoder anterior.

**Lo que NO se logró:** ninguna mejora *sobre* brotli en datos cotidianos. Paridad ≠ ganancia.

## 14. Optimizador global MDL — diseño (no implementado, a propósito)

No se implementó porque con las familias actuales no hay evidencia de que el solapamiento aporte: en el mixto las fronteras caen a ±10 B de los segmentos y la fusión resuelve la continuidad; un DP sobre intervalos solapados solo paga cuando hay ≥ 2 familias que compitan en la misma región y modelos reutilizables entre regiones lejanas. Diseño propuesto para cuando exista una segunda familia integrada (p. ej. f(n)):

- Candidatos = (intervalo [i,j), familia, parámetros, costo real en bits, ¿entra a diccionario?) generados por ventanas variables sobre las puertas ya existentes.
- Selección: DP de intervalos sin solapamiento final, `best[j] = min_i best[i] + cost(i,j)`, con `cost` = bytes serializados reales del candidato (incluido el framing, cuyo peso quedó demostrado en §13) y la opción "literal/raw" como arista; el solapamiento solo existe en la fase de descubrimiento.
- Expresiones compartidas: segunda pasada que, para modelos idénticos en intervalos disjuntos, resta el costo del modelo duplicado y suma una referencia (ya existe para LFSR GF(2⁸): PAD5); iterar hasta punto fijo.
- Criterio de aceptación: mejora de bytes sobre el empaquetado por chunks actual en un corpus *mixto real* (no solo sintético), sin perder en cotidianos.

## 15. Siguiente

1. **Resolver constantes grandes en f(n)** (diferencias finitas modulares, aritmética 2-ádica sobre expresiones afines con shifts) y medir cuánta más familia queda cubierta.
2. **Puerta barata para f(n)** (sin ella no entra al encoder) y criterio de decoder-overhead explícito (tamaño del intérprete amortizado).
3. **Dónde buscar ganancia real sobre brotli en cotidianos**: la matemática exacta no está (§13). Hipótesis a probar con corpus real: estructura *aproximada* en columnas numéricas de formatos (timestamps de pcap, tablas JSON numéricas como `tr46/mappingTable.json`) mediante transformaciones reversibles por campo + brotli, midiendo contra brotli solo.
4. Optimización aparte, byte-idéntica, de `findApproxCyclic` y `runLFSR` (≈ 46 % del CPU del encoder).


## 16. Descubrimiento ciego: ¿reconocer un catálogo o descubrir una representación? (experimento 09)

Código: `src/lab/hidden-gen.ts` (generadores ocultos), `src/lab/synth.ts` (síntesis guiada por propiedades), `scripts/lab-09-blind-discovery.ts`, tests `src/lab/synth.test.ts`. Salidas: `lab-09A-raw.txt`, `lab-09A2-raw.txt`, `lab-09A3-raw.txt` (lote A, desarrollo), `lab-09B-raw.txt` (lote B, N = 65 536) y `lab-09B-N4096-raw.txt` (lote B, N = 4 096).

### Protocolo (diseñado para que el experimento no se engañe a sí mismo)

- **Separación ciega:** los generadores viven en un módulo que ni `synth.ts` ni `expr-search.ts` importan (un test lo comprueba). El buscador recibe un `Uint8Array` y nada más.
- **Parámetros aleatorios por instancia** (constantes de 32 bits, desplazamientos, matrices, máscaras): ninguna instancia está en una rejilla ni en un catálogo. 12 familias; 7 diseñadas para ser descubribles (A afín desplazada `((a·n+b)>>s)&255`, B polinomio grado 2–3 mod 2³², C mezcla lineal GF(2) tipo xorshift, D booleana cuadrática sobre 16 bits de n, E prefijo-XOR de una mezcla lineal, G entrelazado polinomio/xorshift, F suma acumulada de una afín desplazada) y 5 controles esperados como fallo (X1 xorshift de bytes∘polinomio, X2 polinomio∘xorshift, H hash fmix32, T LCG truncado, R aleatorio).
- **Tres niveles de resultado:** DESCUBIERTO = reproduce el entrenamiento y acierta **todos** los índices de [N, 2²⁰); SOBREAJUSTE = reproduce el entrenamiento (comprime) pero no generaliza; FALLO = sin representación aceptada. Una representación se acepta solo si cuesta < 25 % del menor entre brotli-11 y crudo.
- **Dos lotes:** A para desarrollar (10/familia, semillas 1–10), B con semillas distintas (20/familia, semillas 1001–1020) ejecutado una vez con `synth.ts` congelado (hash `3ef4eb9d`).
- **Síntesis guiada por propiedades:** transformación reversible (identidad, delta XOR, delta aditivo, entrelazado m=2) → test de propiedad barato → solver analítico → verificación exacta. Solvers: afín sobre GF(2) (matriz resuelta por álgebra lineal), polinomio mod 256 (coeficientes = diferencias finitas, base binomial), afín desplazada tipo Beatty (pendiente estimada por incrementos, `a` por búsqueda acotada, ventana de `b` por intersección exacta de intervalos circulares), ANF (transformada de Möbius, esparsidad). Las constantes **se resuelven, no se enumeran**.

### Cambios hechos tras ver el lote A (todos declarados)

1. **Protocolo endurecido (arnés):** la primera versión muestreaba 1 500 índices lejanos y daba A = 10/10; comprobar *todos* los índices lo bajó a 8/10: el muestreo ocultaba dos sobreajustes. No se volvió al protocolo débil.
2. **Solver Beatty:** elegir el centro de la ventana de `b` en vez de su extremo inferior (menor error esperado fuera de muestra; redujo los desacuerdos de 5–13 a 2–6 sobre 983 040 índices, no los eliminó).
3. **Arnés:** impresión de detalle de sobreajustes, separación de disparos de propiedad entre diseñadas/controles, parámetro N. Ninguno afecta al solver.
4. Etiqueta corregida: F se esperaba como fallo, pero `delta aditivo` la reduce exactamente a A; el sistema aplicó una transformación y resolvió, que es lo que se quería ver. Se cuenta entre las diseñadas.

### Resultados — lote B, N = 65 536 (DESCUBIERTO / SOBREAJUSTE / FALLO; costo mediano en bits vs brotli-11)

| Familia | Guiado | Catálogo enumerativo (5/fam) | Costo vs brotli (bits) | Ruta ganadora |
|---|---|---|---|---|
| A afín desplazada | 14 / 6 / 0 | 0 / 0 / 5 | 55 vs 7 576 | beatty |
| B polinomio | 20 / 0 / 0 | 0 / 0 / 5 | 37 vs 2 184 | poly |
| C xorshift | 20 / 0 / 0 | 0 / 0 / 5 | 145 vs 9 144 | gf2 |
| D booleana cuadrática | 20 / 0 / 0 | 0 / 0 / 5 | 714 vs 106 776 | anf |
| E prefijo-XOR | 20 / 0 / 0 | 0 / 0 / 5 | 147 vs 9 936 | xor-delta·gf2 |
| G entrelazado | 17 / 3 / 0 | 0 / 0 / 5 | 176 vs 113 920 | interleave2·poly\|gf2 |
| F suma acumulada | 10 / 10 / 0 | 0 / 0 / 5 | 65 vs 391 480 | add-delta·beatty |
| X1, X2, H, T, R (controles) | **0 / 0 / 100** | 0 / 0 / 25 | — | — |

- **Diseñadas: 121 / 140 descubiertas (86 %), 19 sobreajustes, 0 fallos.** **Controles: 0 / 100 aceptados** (cero falsos positivos). **Catálogo enumerativo: 0 / 60.**
- **Disparos de propiedad en controles:** GF(2), polinomio y Beatty **0/100** en cada transformación (no hay falso disparo); ANF dispara en ~30 % de los controles (secuencias periódicas de período 256 con bits bajos dispersos, p. ej. X1) pero el filtro de costo las rechaza.

### Los 19 sobreajustes son límites de identificabilidad, no errores del solver (diagnosticados caso por caso)

- **A (6) y F (10):** todos con desplazamiento grande (A: s = 19–24; F: s = 17–24). Con N = 65 536 el entrenamiento solo acota `b` a una ventana de ~2ˢ/N enteros; la fórmula elegida reproduce el entrenamiento y acierta casi todo (A: 2–20 desacuerdos entre 983 040), pero no es *la* fórmula. En F un único desacuerdo se acumula para siempre en la suma (357 424–975 407 índices erróneos): amplifica la ambigüedad.
- **G (3):** los tres tienen `R8` en el carril impar: el byte bajo depende del bit 15 del índice del carril, que el carril de 2¹⁵ muestras nunca observa. Es una violación del sesgo inductivo declarado ("los bits de índice no observados no influyen"), no un fallo de resolución.

### Sensibilidad al tamaño de entrenamiento: N = 4 096 (tamaño real de chunk de Algex)

| Familia | desc / sobreaj / fallo |
|---|---|
| A | 8 / 12 / 0 |
| B | 20 / 0 / 0 |
| C | 12 / 8 / 0 |
| D | **0 / 20 / 0** |
| E | 7 / 13 / 0 |
| G | 9 / 11 / 0 |
| F | 5 / 15 / 0 |
| controles | 0 / 0 / 100 (ningún falso positivo) |

Con 4 096 muestras solo se observan 12 bits de índice; todo lo que depende de bits 12–15 (D por completo, C/E/G con desplazamientos a la derecha ≥ 5) **se comprime pero no se descubre**. Las 140 diseñadas **se comprimen en todos los casos** (reproducen el entrenamiento con 37–372 bits frente a 2 184–29 680 de brotli); lo que se pierde al acortar es la *generalización*. Es exactamente la distinción pedida: comprimir una secuencia concreta ≠ descubrir la función que la generó.

### Lectura (qué queda establecido y qué no)

**Establecido:** (1) un sintetizador guiado por propiedades **recupera con exactitud verificada representaciones de funciones ocultas con parámetros aleatorios de 32 bits**, en un 86 % de los casos y con 100 % de los fallos explicables por identificabilidad; (2) el enumerador con rejilla del experimento 07 recupera **0 de 60** de esas mismas instancias: la capacidad "descubrir" y la capacidad "reconocer del catálogo" son realmente distintas; (3) cero falsos positivos en 200 controles (100 + 100 a N=4 096); (4) la generalización depende de cuántos bits de índice observa el entrenamiento, y eso se puede medir.

**No establecido / límites:**
- **Las familias las diseñé yo, y los cuatro solvers corresponden a cuatro familias algebraicas concretas.** Lo descubierto es "una función de esas familias con parámetros desconocidos", no "una función arbitraria". La ganancia sobre el catálogo es real; la generalidad, no.
- **Composiciones entre familias: 0 / 40** (X1 byteLin∘polinomio, X2 polinomio∘xorshift). Las transformaciones solo componen lo que tengo (delta, prefijo, entrelazado); no sé "pelar capas" arbitrarias. Esa es la frontera real del método.
- **B y X1 son periódicas (período 256)**: un detector cíclico también las comprimiría a 2 048 bits (frente a 37 de la fórmula); no se midió contra el cíclico de Algex. El valor de B es la fórmula, no la compresión.
- Tiempo: 3–200 ms por instancia a N = 65 536 (F: 215 ms); costo del intérprete de la representación **no contabilizado**.
- **Nada de esto afecta a archivos cotidianos.** La cobertura de estructura exacta en datos reales era 0 % (§13); este experimento demuestra capacidad de descubrir en secuencias ocultas, no mejora sobre brotli en código, JSON o imágenes. Para eso, como se advirtió, hará falta combinar descubrimiento algebraico con modelos estadísticos de predicción. **No se integró nada al encoder.**

### Siguiente (por orden de valor)

1. **Pelado de capas** para composiciones entre familias (X1, X2): resolver una capa por álgebra y comprobar si el residuo cae en otra familia; es la mayor brecha entre "reconocer" y "descubrir".
2. **Identificabilidad como criterio de aceptación:** exigir que N supere el umbral de identificación (o reportar el intervalo de ambigüedad) antes de llamar "descubrimiento" a una fórmula; hoy solo se detecta comparando con la verdad oculta.
3. **Combinación con modelos estadísticos** (la advertencia planteada): usar la fórmula como *predictor* con residual modelado por contexto, para datos que no son exactamente algebraicos; medir contra brotli en un corpus real con estructura numérica aproximada (columnas de pcap, `tr46/mappingTable.json`).



## 17. Síntesis composicional: pelado de capas (experimento 10, Etapas 1–2)

Código: `src/lab/ast.ts` (AST serializable, evaluación vectorial, codificación de bits exacta, simplificación), `src/lab/probes.ts` (sondas de propiedades), `src/lab/compose.ts` (peelers + búsqueda), `src/lab/hidden-compose.ts` (generadores ocultos, no importado por el buscador; un test lo comprueba), `scripts/lab-10-audit.ts`, `scripts/lab-11-compose.ts`, tests `src/lab/compose.test.ts`. Salidas crudas: `lab-10-audit-raw.txt`, `lab-11-X-raw.txt`, `lab-11-A-raw.txt`, `lab-11-A2-raw.txt`, `lab-11-A3-raw.txt`, `lab-11-B-raw.txt`, `lab-11-Bposthoc-raw.txt`.

### Etapa 1 — Auditoría: por qué fallaron X1 y X2
Los cuatro solvers de §16 exigen que la secuencia ya esté en la forma de su familia (o sea delta/prefijo/entrelazado de ella). Una capa lineal sobre GF(2) rompe esa forma (`lab-10-audit-raw.txt`):
- **Absorción (cierre):** C absorbe cualquier capa afín GF(2) (sigue siendo afín); D/ANF absorbe permutaciones de bits del índice; poly absorbe `addc` y `mulo`. Esas composiciones no son composiciones reales para el sistema.
- **X1** (byteLin∘poly): el ANF dispara 8/8 pero cuesta miles de bits; el polinomio desaparece porque un mapa afín de bytes no es aritmético. Sobrevive el período (128–256) y la **triangularidad**: el plano j de un polinomio mod 256 depende solo de n mod 2^(j+1); el span de los planos es invariante bajo la capa.
- **X2** (poly∘xorshift): sobrevive el grupo de simetrías XOR del índice (dim 8): y es función de una proyección lineal de n.

### Etapa 2 — Motor mínimo de composición (profundidad ≤ 3)
Peelers: delta/prefijo, entrelazado, capas enumeradas de 8 bits (xorc, addc, mulo, rotl; solo se aceptan si el residuo lo resuelve una hoja), **`baffLift`** (levantamiento triangular 2-ádico del mapa afín de bytes, con poda por consistencia polinómica mod 2^(j+1)), **`idxQuotient`** (cociente por simetrías XOR) e **`idxLiftPoly`** (levantamiento triangular del mapa afín del índice). El costo es la longitud real de la codificación del AST. **Familia declarada para el pelado: polinomios de grado ≤ 4** (poda; las hojas aceptan hasta 12).

### Cambios hechos tras ver los datos (todos declarados)
1. Poda de `baffLift`: sin tope de grado el DFS agotaba 3 M de nodos; con grado ≤ 4 encuentra la cadena (~0,9 M nodos).
2. Planos dependientes (rango afín < 8): la condición correcta es span(a)+V₀ = GF(2)⁸, no independencia; hubo que admitir filas repetidas (en X1#2 los planos 0 y 1 de p son complementarios).
3. Lote A: prohibir apilar peelers enumerados y exigir que el residuo de una capa enumerada lo resuelva una hoja (A3 pasó de 20 s a 1,3 s).
4. Opción `greedy` (post-lote B, ver abajo). Por defecto reproduce el comportamiento ejecutado en el lote B.

### Resultados
**Referencia X (X1/X2 del §16, 10 inst.; los peelers se diseñaron mirando estas, NO es evaluación ciega):** motor 18/20 (X1 10/10, X2 8/10) frente a 0/20 del solver congelado del exp. 09 y 0/20 del motor sin peelers de composición. Costos 125–183 bits frente a 1 192–11 272 de brotli.

**Lote A (desarrollo, A1–A5, 10 inst.):** 49/50 (A1 9/10, resto 10/10). Congelado del 09: 14/50. A1 tarda 7 s de mediana (baffLift corre aunque la capa enumerada ya resolvió).

**Lote B (ciego, ejecutado UNA vez, motor congelado `compose=6a2f9a76`, 10 inst./clase, N=65 536, 8 s):**

| Clase | Motor desc/sobreaj/fallo | Congelado 09 | Costo mediano vs brotli | Lectura |
|---|---|---|---|---|
| B1 afín8∘poly | 10/0/0 | 0 | 117 vs 2 184 | misma clase de peeler, matriz nueva (no xorshift) |
| B2 bitperm∘poly | 9/0/1 | 0 | 117 vs 1 552 | idem |
| B3 poly∘selección-de-bits(n) | **0/0/10** | 0 | — | ver diagnóstico |
| B4 poly∘afín(n) | 10/0/0 | 0 | 199 vs 20 080 | 6 con fórmula; 4 con tabla de 2^r bytes (compresión sin fórmula) |
| B5 afín8∘beatty | 1/0/9 | 0 | — | fuera del diseño: no hay levantamiento para Beatty |
| B6 rotl∘gf2 | 10/0/0 | 10 | 145 vs 11 776 | absorbida (no es composición real) |
| B7 mulo∘poly | 10/0/0 | 10 | 41 vs 2 184 | absorbida |
| B8 xorc∘afín8∘poly | 10/0/0 | 0 | 117 vs 2 152 | tres capas; baff absorbe xorc |
| B9 afín8∘poly∘sel(n) | 0/0/10 | 0 | — | dos lados: sin peeler |
| B10 xor(beatty,poly) | 0/0/10 | 0 | — | operación binaria: sin peeler |
| B11 add(beatty,poly) | 7/0/3 | 4 | 91 vs 4 272 | **no explicado** (ver límites) |
| B12 poly∘beatty | 3/0/7 | 4 | 820 vs 3 920 | idem |
| B13 ANF∘sel-de-bits | 10/0/0 | 10 | 823 vs 26 360 | absorbida |
| B14 prefijo-xor∘afín8∘poly | 10/0/0 | 0 | 122 vs 2 144 | delta + baff |

**Total lote B: 90/140 descubiertas, 0 sobreajustes, 50 fallos.** Las tres métricas por separado: *descubrimiento* = lo anterior (verificado en todos los índices de [N, 2²⁰)); *compresión* = toda representación aceptada reproduce el entrenamiento con < 25 % de brotli (incluye casos de B4 con tabla literal, que comprimen sin ser fórmula); *generalidad* = ver más abajo.

**Generalidad (lo que realmente se midió).** Por tipo de composición:
- *Misma clase de peeler, parámetros y capas nuevos* (B1, B2, B4, B8, B14): 49/50. Prueba que el levantamiento triangular generaliza a matrices 8×8 arbitrarias, permutaciones de bits y capas extra; **no** que el método descubra composiciones arbitrarias.
- *Composiciones absorbidas* (B6, B7, B13): 30/30, pero ya las resolvía el solver congelado: no son evidencia de composición.
- *Fuera del diseño* (B3 en la corrida ciega, B5, B9, B10, B11, B12): 11/60, con resultados no explicados en B11/B12. **La frontera sigue ahí.**

### Diagnóstico de B3 (post-hoc, NO ciego)
B3 falló 0/10 en el lote B porque la regla golosa aceptó un ANF de 148 monomios (2 433 bits) antes de probar el cociente de índice (183 bits, exacto). Es un defecto de control de búsqueda, no del método. Repetición con `greedy: 0` sobre B3, B5, B9–B12 (`lab-11-Bposthoc-raw.txt`): B3 sube a 5/10; B5 1/10, B9 1/10, B10 0/10, B11 7/10 y B12 3/10 quedan igual. Los 5 fallos restantes de B3 son instancias degeneradas (polinomio con 44 valores distintos → r = 7, y la tabla no es polinomio en las coordenadas del cociente). El resultado del lote B se mantiene como se ejecutó.

### Límites y cosas no establecidas
- **B11/B12 inexplicados.** Esperaba fallo y salen 7/10 y 3/10 por rutas `il2` profundas, con verificación exacta en [N, 2²⁰). Tampoco el motor sin peelers de composición (solo delta/il2) los explica: resuelve 7/10 y 4/10. Los valores de desplazamiento s de las instancias de B11 llegan a 6, así que "s ≤ 3 deja los carriles polinómicos" no basta. El resultado es exacto, pero no sé por qué ocurre; no lo cuento como logro de composición.
- **Las clases las diseñé yo y los peelers cubren exactamente: polinomio con capas GF(2) por el lado de la salida o por el del índice.** No hay levantamiento para Beatty, ANF ni operaciones binarias (0–1/10).
- **Identificabilidad (Etapa 4) no implementada.** En B4 con tabla literal la representación solo reproduce el chunk; el sistema no distingue "solución única" de "compatible".
- **Tiempo:** 1 ms–7 s por instancia en aciertos, hasta el presupuesto (8–20 s) en fallos. `baffLift` hasta 3 M de nodos.
- **Sin integración y sin datos reales:** nada de esto toca el encoder ni PAD6. No se midió contra brotli en código/JSON/imágenes (Etapa 6). Los costos son los de la representación del AST, sin encabezado de longitud (~2·log₂N bits).
- Lote B con 10 instancias por clase (el §16 usó 20) y 8 s por instancia, para acotar el tiempo.
- Sin mejora demostrada sobre brotli en archivos cotidianos.

### Recomendación
Continuar, pero sin añadir más peelers de este tipo todavía. (1) Explicar B11/B12 y arreglar el control de búsqueda (la regla golosa resultó frágil). (2) Hacer la Etapa 4 (identificabilidad) antes de la 5. (3) Los peelers siguientes con más valor son el de **dos lados** (B9) y el de **operaciones binarias** (B10), que se parecen más a funciones reales. (4) La Etapa 6 sigue siendo el único camino hacia archivos cotidianos y exige modelos predictivos, no solo fórmulas exactas.



## 18. Diagnóstico de B11/B12: dos mecanismos 2-ádicos, control de búsqueda y lotes C y D (experimento 11)

Código: `scripts/lab-12-diagnose-b11.ts`, `lab-13-twoadic-claims.ts`, `lab-13b-decimation-degree.ts`, `lab-14-blind-c.ts`, `lab-15-b5-by-j.ts`, `lab-15-x2-gate-ab.ts`; cambios en `src/lab/compose.ts` (control de búsqueda) y `src/lab/hidden-compose.ts` (clases C1, C2, D1, D3 y rejilla `makeGrid`). Pre-registro: `prereg-lote-C.md` (con adenda del lote D). Salidas crudas: `lab-12-diagnose-raw.txt`, `lab-13-twoadic-raw.txt`, `lab-13b-decimation-raw.txt`, `lab-11-A4…A6-raw.txt`, `lab-14-C-*-raw.txt`, `lab-14-posthoc-il2gate-raw.txt`, `lab-14-D-main-raw.txt`, `lab-14-D-grid-raw.txt`, `lab-15-*-raw.txt`.

### 18.1 Por qué B11/B12 "funcionaban"
Se corrigió primero un error de lectura mío: en `lab-12-diagnose-raw.txt` varias instancias B11 son exactas pero cuestan 24 000–65 000 bits (tablas de 4 096 entradas); esas el criterio de aceptación las rechaza, y de ahí sale 7/10 y no 10/10.

Sea j = s − v₂(a) para el Beatty ⌊(a·n+b)/2^s⌋ (a = 2^t·impar).
- **Estructura:** ⌊(a·n+b)/2^s⌋ = (pendiente racional con denominador 2^j)·n + parte periódica de período 2^j. Es 2-ádicamente regular: la secuencia es periódica con período 2^(s+8).
- **Medido (`lab-13-twoadic-raw.txt`):** los coeficientes de Mahler (base binomial) de (n mod 2) mod 256 son (−2)^(k−1): 9 coeficientes. El número de coeficientes mod 256 de ⌊(a·n+b)/2^s⌋ depende solo de j (no de a ni de b): **2, 10, 19, 37, 73 para j = 0…4** (9·2^(j−1)+1) y más de 90 desde j = 5. P∘f cuesta M(j)+2^(j−1) (3, 11, 21, 41, 81).
- **M1 (lema de diezmado):** sobre n = 2^k·i + c, a se multiplica por 2^k y j pasa a max(0, j−k). Verificado: la columna k de la tabla es la fila j−k desplazada.
- **M2 (nilpotencia):** (2^k)^m ≡ 0 mod 256 si k·m ≥ 8, así que en cada carril un polinomio entero de grado ≤ 4 tiene grado efectivo ≤ ⌈8/k⌉−1 (`lab-13b`: con k = 4 todos tienen ≤ 2 coeficientes, o sea son lineales). Además Beatty + lineal = Beatty (identidad verificada en 2 000 × 64 casos). Por eso, con k = 4, add(beatty, poly) se reduce a carriles Beatty, que la hoja Beatty ya resuelve.
- **Frontera de la hoja polinómica:** acepta ≤ 12 coeficientes, o sea j' ≤ 1. Con 3 niveles de `il2`, j ≤ 4 (los 10 casos de B11 coinciden exactamente con esa regla).
- **Genuino o coincidencia:** las representaciones aceptadas son exactas para todo n, no solo hasta 2²⁰: la secuencia oculta tiene período 2^(s+8) ≤ 2^20 y la representación (polinomios mod 256 de grado ≤ 12 y Beatty) también es periódica con período que divide 2^20; coinciden en [0, 2²⁰). No es el generador original: es una representación equivalente y compacta.

### 18.2 Corrección del control de búsqueda
Defecto (B3 y G11 j=2 del lote C): una hoja cara (ANF exacto por periodicidad) tapaba las rutas de pelado/`il2`. Corrección: la regla golosa por fracción del respaldo (0,1, ajustada) se sustituye por una cota **derivada**: una hoja se acepta sin explorar capas solo si cuesta ≤ el costo mínimo de una composición (`MIN_COMPOSED_BITS` = 27 bits, calculado del códec); cada peeler se explora solo si su capa más la hoja mínima puede ganar (branch-and-bound); `il2` pasa de "solo sin hoja" a la misma cota (`LB_IL2`). Lote A de desarrollo tras la cota de peelers: 49/50 con tiempos normales. Tras la cota de `il2`: **47/50 y tiempos ×100 en A2/A5** (la cota es válida pero laxa).

A/B limpio sobre X2 (`lab-15-x2-gate-ab-raw.txt`): control antiguo 9/10 y 6/10 con semillas 2001–2010 y 3001–3010; control nuevo 7/10 y 5/10. La variación entre semillas (9 → 6 con el mismo control) pesa más que el cambio de control; el control nuevo cuesta 1–2 aciertos en X2 y es 2,4–7× más lento.

### 18.3 Lote C (ciego, motor `compose=ed9d9e12`, semillas 2001+, 10 por clase)
| Grupo | Descubiertas | Exactas no aceptadas |
|---|---|---|
| Diseñadas, tipos ya vistos (B1, B2, B3, B4, B8, B14, X1, X2) | 73/80 | 7 |
| Diseñadas, composición nueva (D1, D3) | 18/20 | 2 |
| Fuera de diseño (B5, B9, B10, C1, C2) | 12/50 | 32 |
| Controles (H, R, T) | 0/30 | 0 |

Rejilla G11/G12 con profundidad 3 (descubiertas): j = 0 y 1: 10/10 en ambas; **j = 2: 0/10 y 0/10**; j = 3: 7/10 y 3/10; j = 4: 10/10 y 5/10; j = 5, 6, 8: 0/10 (G11 j=5 y 6: 10 exactas no aceptadas por costo). Las predicciones P1 (j ≤ 3 ≥ 9/10) y P3 (B3 ≥ 50 %: salió 4/10) **fallaron**; la causa de j=2 fue el defecto de control. C1 (xor de poly y gf2) salió 10/10 aunque predije ≤ 10 %: el ANF es cerrado bajo XOR y poly es ANF-disperso (explicación no verificada aparte).

**Profundidad (P2):** profundidad 4 limpia: j = 4, 5, 6, 7 → 5/5, 5/5, 5/5, 4/5 descubiertas (mi predicción decía "exactas no aceptadas" para j ≥ 5; fallaba, y la causa es M2). Profundidad 5, tanto con 8 s como con 40 s: **0/5 en todo** (j=4: exactas no aceptadas). Peor que profundidad 4 y **sin explicar**. Las corridas de profundidad 4/5 que coincidieron con otro proceso están guardadas como `-contended-` y no se usan.

**Post-hoc (no ciego), control de `il2` corregido, semillas de C, celdas j = 2, 3:** G11 j=2 7/10 (10 aceptadas: 3 sobreajustes), j=3 9/10 (1 sobreajuste); G12 j=2 y j=3 10/10.

### 18.4 Lote D (ciego, motor congelado `compose=2ce8c5ee`, semillas 3001+, 10 por clase)
| Grupo | Descubiertas | Exactas no aceptadas |
|---|---|---|
| Diseñadas, tipos ya vistos | 71/80 | 9 |
| Diseñadas, composición nueva | 18/20 | 2 |
| Fuera de diseño | 15/50 | 31 |
| Controles | 0/30 | 0 |

Por clase: B1 10, B2 9, B3 7, B4 10 (aceptadas), B8 10, B14 10, X1 10, X2 5, D1 9, D3 9, B5 5, B9 0, B10 0, **C1 10**, C2 0, H, R, T 0.

Rejilla (descubiertas / aceptadas), profundidad 3:
| j | G11 | G12 |
|---|---|---|
| 0 | 10/10 | 10/10 |
| 1 | 10/10 | 10/10 |
| 2 | 9/10 | 10/10 |
| 3 | 8/10 (10 acept.) | 10/10 |
| 4 | 10/10 | 7/10 |
| 5 | 1/10 | 0/10 |
| 6 | 1/10 | 0/10 |
| 8 | 0/10 | 0/10 |

**Contraste con lo pre-registrado:** se cumplen todas las predicciones salvo dos. **G12 j=4: 7/10** (predije ≥ 8; las otras 3 son exactas pero demasiado caras) y **B5: 5/10** (predije ≤ 20 %). Para B5, `lab-15-b5-by-j-raw.txt` lo explica con M1: los 5 aciertos tienen j ≤ 2 (ruta `il2>(baff>poly|baff>poly)`: el diezmado vuelve polinómico el Beatty y luego se pela la capa afín) y los fallos reales tienen j ≥ 7; hay 2 instancias degeneradas (j ≤ 0) que `baffLift` no resuelve y caen en tabla periódica (limitación aparte, no investigada). La mediana de tiempo sube (X1 ~20 s) porque el tope de 8 s no se comprueba dentro de `baffLift`/`idxLiftPoly`.

### 18.5 Lectura: dentro y fuera de las clases diseñadas
- **Dentro (B1, B2, B8, B14, X1, D1, D3):** 87–100 % por clase, con 109–191 bits frente a 1 200–3 600 de brotli, en dos lotes ciegos con semillas distintas. D3, una clase no usada para diseñar, sale 8/10 y 9/10: el mecanismo (cociente del índice más levantamiento triangular) cubre composiciones nuevas de la misma clase, no más.
- **Fuera:** B9 (dos lados), B10 (xor de beatty y poly) y C2 (suma de poly y gf2) siguen sin solución (0/10 en ambos lotes). Los aciertos fuera de diseño (C1, B5 parcial, G11/G12) se explican por propiedades 2-ádicas concretas, no por un método general de composición.
- **Propiedad generalizable hallada:** el **diezmado por 2^k** como simplificador 2-ádico. Reduce j (M1) y reduce grados polinómicos (M2), con costo creciente: 2^k carriles. `il2` ya lo implementa, pero limitado por profundidad y con búsqueda ramificada. Aún no se ha probado un diezmado 2^k directo con k elegido por la teoría (no se implementan peelers nuevos en esta etapa).
- **Límites:** la hoja polinómica acepta ≤ 12 coeficientes; el mismo Beatty con j ≥ 5 solo se resuelve con costo alto (14 000–22 000 bits) y casi siempre queda fuera del umbral; los sobreajustes (aceptadas no exactas) aparecen en carriles Beatty no identificables (G11 j=2, 3).
- **Sin explicar:** (1) profundidad 5 peor que profundidad 4; (2) por qué C1 se resuelve con ANF solo (cierre bajo XOR, hipótesis); (3) las 2 instancias degeneradas de B5; (4) los tiempos que exceden el tope.
- **Sin cambios:** nada se integró al encoder ni a PAD6; no hay mejora demostrada sobre brotli en archivos cotidianos.

### 18.6 Recomendación
1. Arreglar la ingeniería primero (comprobar el reloj dentro de `baffLift`/`idxLiftPoly`, cota más estricta para `il2`): sin eso las corridas son demasiado lentas para iterar.
2. Probar el diezmado 2^k con k derivado de la teoría como peeler explícito (con costo de 2^k carriles) y medir si compite con `il2` por profundidad.
3. Identificabilidad (Etapa 4): los sobreajustes de G11 j=2, 3 son su caso natural.
4. Composiciones de dos lados (B9) y operaciones binarias (B10, C2), que siguen en 0/10.
5. La Etapa 6 (datos reales con modelos predictivos) sigue siendo el único camino hacia archivos cotidianos.



## 19. Estabilización: presupuesto determinista, profundidad monótona y puertas exactas (experimento 12, parte 1)

Código: cambios en `src/lab/compose.ts` (contador de trabajo, etapas, incumbente global, puertas), tests nuevos en `src/lab/compose.test.ts` (determinismo, monotonía, presupuesto). Scripts: `lab-16-calibrate.ts`, `lab-16-primitives.ts`, `lab-16-profile.ts`, `lab-16-regress.ts`, `lab-16-x1.ts`, `lab-16-budget-curve.ts`. Salidas: `lab-16-*-raw.txt`. **Semillas de desarrollo** (no es un lote ciego).

### Problema de partida
Las corridas de los lotes C y D tenían tres defectos de ingeniería que contaminaban la interpretación: (1) el tope de tiempo se medía con reloj y no se comprobaba dentro de `baffLift`/`idxLiftPoly` (medianas de 20 s con tope de 8 s); (2) dos procesos concurrentes cambiaban los resultados; (3) la profundidad 5 daba peores resultados que la 4 sin explicación.

### Cambios (todos declarados)
1. **Contador de trabajo determinista.** Cada hoja, peeler y, dentro de los levantamientos, cada estado y nodo cobra unidades (≈ 1 ns de CPU de la máquina de referencia, constantes medidas en `lab-16-primitives-raw.txt`). El contador no lee el reloj; `ms` queda como seguro (120 s). Test: mismos datos y opciones → mismo costo, trabajo y ruta.
2. **Monotonía en profundidad por construcción.** Etapas 0…D; el presupuesto de la etapa d es `W·2^d`, independiente de `maxDepth`; el resultado es el mínimo sobre etapas. Test: el costo no aumenta con `maxDepth` (4 instancias, d = 0…3). Con `W = 7·10⁸`, el máximo de `maxDepth = 3` es 15·W ≈ 10 G unidades ≈ 3–4 s.
3. **Incumbente global.** La mejor solución encontrada se propaga como cota superior por toda la recursión y por las etapas siguientes. Para `idx` no se resta el coste de capa porque `simplify` fusiona `idx∘idx`. Efecto medido: la instancia B1 que tardaba 90 s tarda 1,7 s con el mismo resultado.
4. **Puertas exactas (condiciones necesarias, no heurísticas).** En `idxLiftPoly`: `rank(S_j) ≤ j+1` para todo j (si no, no existe cadena). En `baffLift`: `dim V_k ≥ k` para k = 1…8. La llamada `idxLiftPoly` que consumía 118 s en sub-búsquedas sin solución pasa a 9 ms (además se eliminó un `rankOf` con ~260 elementos por candidato).
5. **Poda por coeficientes enteros.** Para el pelado, el polinomio debe tener coeficientes **enteros** de grado ≤ 4: `c_k = Δᵏp(0) ≡ 0 (mod 2^{v₂(k!)})`. Es más estricto que "entero-valuado" (las hojas siguen aceptando entero-valuados hasta grado 12). Ahorra ~37 % de nodos en las instancias degeneradas (943 k → 589 k).
6. **Orden de exploración:** peelers específicos (con puertas exactas) primero; `delta` e `il2` (genéricos y caros) al final.
7. **Comprobación de presupuesto antes de cada bloque de peelers** (antes, un nodo ya sin presupuesto seguía ejecutando todos los bloques).

### Resultados (semillas de desarrollo, `lab-16-regress2-raw.txt`, N = 65 536)
| Clase | Descubiertas | Tiempo mediano (máx) | Trabajo mediano |
|---|---|---|---|
| A1 xorc∘poly | 10/10 | 0,23 s (0,36) | 0,5 G |
| A2 rotl∘poly | 10/10 | 0,18 s (0,21) | 0,5 G |
| A3 mulo∘beatty | 10/10 | 5,0 s (10,8) | 7,1 G |
| A4 xorc∘beatty | 10/10 | 1,2 s (1,3) | 2,1 G |
| A5 addc∘poly | 10/10 | 0,23 s (0,28) | 1,3 G |
| X1 | 10/10 | 1,5 s (3,6) | 8,0 G |
| X2 | 9/10 | 1,7 s (2,2) | 4,7 G |

Antes de la estabilización el mismo lote A daba 47–49/50 con medianas de hasta 22 s. **Curva éxito–presupuesto** (`lab-16-budget-curve-raw.txt`): X1#2 y X1#8 (planos dependientes) necesitaban `W = 6·10⁹` con la versión inicial; tras las puertas, la poda y el reordenamiento se resuelven con `W = 7·10⁸` en la etapa 3.

### Profundidad (G11, 5 instancias, `lab-16-depth2-raw.txt`)
| j | profundidad 3 | profundidad 4 | profundidad 5 |
|---|---|---|---|
| 4 | 5/5, coste 500, 2,3 s | 5/5, **coste 288**, 4,6 s | 4/5, coste 288, 10,8 s |
| 5 | 0/5, 1,6 s | **5/5**, coste 376, 7,8 s | 4/5, coste 376, 21 s |
| 6 | 0/5, 1,6 s | **5/5**, coste 524, 4,8 s | 5/5, coste 524, 23 s |

- La anomalía de profundidad 5 **desaparece en coste** (ahora ≥ igual que profundidad 4, por construcción). Pero en j = 4 y 5 una instancia queda **aceptada y no exacta** (sobreajuste) con profundidad 5: un coste menor no implica mejor generalización. Más profundidad = más flexibilidad = más riesgo de ajustar parámetros no identificables.
- El límite teórico "j ≤ profundidad + 1" del §18 era incompleto: con profundidad 4, M2 reduce la parte polinómica a lineal y Beatty + lineal = Beatty, de modo que j = 5 y 6 se resuelven con hojas Beatty por carril.
- El tiempo crece rápido con la profundidad (≈ 2×–2,5× por nivel).

### Límites y cosas no establecidas
- La estabilización se midió con semillas de desarrollo; no hay lote ciego nuevo todavía.
- El contador es un proxy: la relación trabajo/tiempo oscila entre ~3 y ~7 unidades por ns según la instancia.
- A3 sigue tardando hasta 10,8 s (presupuesto agotado en las etapas altas).
- El sobreajuste con profundidad 5 es un efecto de identificabilidad aún no tratado.
- Sin integración ni datos reales.

### Siguiente
Diezmado por potencias de 2 como transformación general (con compartición de parámetros entre carriles y controles negativos, incluido diezmado por módulos que no son potencias de 2), con una identificabilidad mínima antes de interpretar resultados.


## 20. Diezmado por módulo m como transformación general (experimento 12, parte 2)

Código: `src/lab/decimate.ts` (carriles + compartición de parámetros reversible, no importa generadores ocultos), `decimate.test.ts` (8 tests), `scripts/lab-17-decimation.ts`, `lab-17b-diagnose.ts`, `lab-17c-score.ts`. Pre-registro: `prereg-diezmado.md` (predicciones + adenda 1 de desarrollo + adenda 2 del lote ciego, escrita antes de correrlo). Salidas: `lab-17-dev-*-raw.txt` (semillas 4001–4003, desarrollo) y `lab-17-blind-{g11,g12,classes}-raw.txt` (semillas 5001–5010, ciego). Solver congelado (compose `c1898eee`). Suite: 29 archivos, 304 tests.

### Diseño
Los mismos 2^16 bytes se parten en m carriles `y(m·i+c)` (longitud potencia de 2: ojo, para m no potencia de 2 esto descarta datos, ver confusión más abajo). Cada carril se resuelve con el solver congelado (profundidad 2). **Aceptación**: bits compartidos totales < 25 % de min(brotli, crudo) de los mismos bytes. **Exactitud** (aparte): todos los carriles extrapolan sin error hasta 2^20. **Selección sin oculto**: entre los m aceptados, el de menos bits; después se mira si es exacto y si pasa una prueba de estabilidad por mitades (reresolver con la primera mitad del carril y comprobar que reproduce el carril entero).

Dos cambios declarados antes del lote ciego: (1) aceptación por total, no por carril (la regla por carril rechazaba carriles muy compresibles por brotli aunque fueran exactos); (2) prueba de mitades añadida.

### Resultados en G11 = add(beatty, poly) (ciego, 10 por celda)
Con m = 1 (profundidad 2) se resuelve j ≤ 3; con diezmado par se resuelve **cualquier j probado (hasta 10)** a m = 4, 8, 12, 16 (40/40 celdas con ≥ 9/10 exactas); con m impar (3, 5) o v₂(m) = 1 (2, 6, 10) hay un techo (j ≤ 3 y j ≤ 4). Ley R1 (post hoc, fijada con desarrollo): **0 violaciones en 41 celdas "resueltas" y 1 en 33 "no resueltas"** (j = 5, m = 2: 2/10 en lugar de ≤ 1). Que m = 16 resuelva j = 2, 3, 4 con trabajo ≈ 0 y coste constante (165 bits) indica que los carriles son hojas Beatty puras: el colapso por nilpotencia (M2) es el mecanismo, con la parte polinómica volviéndose lineal.
Economía: j = 3 baja de 379 bits (m = 1) a 111 (m = 8); para j = 4…10, que sin diezmado no se resuelven, m = 16 cuesta 165–275 bits frente a brotli de 30 000–520 000 bits.

### G12 = poly∘beatty: R1 REFUTADA (21 violaciones en 41 celdas "resueltas")
La predicción registrada trataba G12 igual que G11. No colapsa: la capa P actúa de forma no lineal sobre el byte del Beatty, y Beatty + lineal ya no es el cierre relevante. Lo que se observa es la ley M1 sola: resuelta hasta j ≈ v₂(m) + 2 (m=1: j ≤ 2 con 9/10 en 3; m=2: ≤ 3; m=4: ≤ 4; m=8: ≤ 5; m=16: 5 con 9/10 y 6 con 6/10); más allá, 0/10 en todos los módulos (j = 7, 9, 10 nunca se resuelven). Esa ley "R2: j ≤ v₂(m)+2" para G12 es **post hoc y está sin probar**; las 4 celdas débiles (j=3 m=10 4/10; j=3 y 4 con m=12 7/10; j=6 m=16 6/10) tienen L = 4096.
→ La diferencia G11/G12 es la prueba más limpia obtenida de que hay dos mecanismos distintos (M1 y M2), pero la predicción que los fundía quedó mal.

### Clases (ciego)
| Predicción | Resultado |
|---|---|
| Controles H, R, T: 0 selecciones | **Cumplida**: 0/30 instancias, 0 carriles aceptados en 300 combinaciones (instancia × m) |
| A1, A3, B1, B7 exactas con m = 1 (10/10), sin selección no exacta | **Cumplida** (10/10 en las cuatro). El diezmado no aporta aciertos aquí |
| B11 ≥ 8/10 con v₂ ≥ 2 | **Cumplida**: 4/10 con m=1 → 10/10 con m = 4, 8, 12, 16 (exactas y estables). Descubrimiento nuevo atribuible al diezmado |
| B10: 0/10 con v₂ ≤ 2 y ≥ 5/10 con v₂ ≥ 3 | **Refutada**: 1, 1, 2, 2, 2 /10 con m = 1, 2, 4, 8, 16. **El resultado de desarrollo (2/3 con m = 8, 16) no se replicó**; con 3 semillas era ruido. El diezmado no resuelve B10 |
| C2 = add(poly, gf2): 0/10 en todo m | **Refutada, y en el sentido interesante**: 1, 3, 4, 6, 7 /10 con m = 1, 2, 4, 8, 16 (creciente en v₂), **0/10 con m impar**, todas exactas y estables, ~2900 bits con m=16 frente a brotli de 66 056. Antes del diezmado C2 estaba en 0/10 |
| C1: ganancia ≤ 10 % de bits | Cumplida a nivel de medianas (−4 % con m = 2); 3/10 elegidas son exactas pero "inestables" por mitades (la prueba es conservadora) |
| X1 sin nada nuevo | Cumplida salvo +1 instancia (9/10 → 10/10 por selección) |
| B12 sin ley previa | 2–4/10 en todo m, sin estructura clara |
| Compartición m = 16, j ≥ 4: bits compartidos ≤ 0,6 × independientes | Cumplida en medianas (0,42–0,54); **no verificada a nivel de instancia** (el crudo solo trae medianas) |

### Efectos negativos del diezmado (no predichos)
* **Puede destruir lo que m = 1 resuelve**: B1 (afín8∘poly) 10/10 con m = 1 → 4/10 con m = 4 y 0/10 con m = 8 y 16; X1 9/10 → 0/10 con m = 8, 16; A1 10/10 → 4/10 con m = 12 y 16. Hipótesis (sin verificar): en el carril la parte polinómica solo ocupa los bits altos, la imagen del carril es un subespacio y el mapa afín del byte deja de estar determinado (planos dependientes).
* **La compartición falla cuando el solver da formas distintas a carriles equivalentes** (A1: `xorc∘poly(3)` en unos y `poly(4)` en otros). Es limitación de la capa de compartición, sin solución en este lote.
* **m impar es neutral o dañino**: nunca resuelve un j que m = 1 no resuelva y los carriles cuestan 3× más (G11 j = 3: 379 → 1134 con m = 3).

### Qué se puede y qué no se puede afirmar
* Se puede: el diezmado por 2^k es una transformación general que amplía lo que el solver congelado descubre en composiciones con Beatty (G11, B11) y en C2; la parte impar del módulo no ayuda (G11, C2); los controles dan 0 falsos positivos; la selección sin oculto nunca eligió un modelo no exacto (0/230 instancias con selección).
* No se puede: afirmar "la parte impar es irrelevante" como ley limpia. Hay una **confusión** con la longitud del carril: para m = 3, 5, 6, 10, 12 el carril se trunca a la potencia de 2 inferior y se descartan hasta el 37 % de los datos; en G12 las celdas frontera empeoran con la parte impar (j = 3: 9/10 con m = 1, 3/10 con m = 3, 0/10 con m = 5).
* No se puede: evaluar la prueba de mitades como detector de sobreajuste. No hubo **ninguna** selección aceptada y no exacta (0 positivos), así que su sensibilidad quedó sin medir; solo se observaron 3 falsas alarmas (C1). La identificabilidad real sigue pendiente.
* No se puede: extrapolar a datos reales. Todo es sintético y de generadores que yo diseñé; ninguna mejora sobre brotli en archivos reales.
* Las leyes R1 y R2 se fijaron mirando desarrollo; R1 sobrevivió al ciego en G11 (1 violación en 74 celdas), R2 todavía no se ha probado.

### Siguiente (condición de salida acordada)
**Sonda sobre datos numéricos reales antes de construir más solvers**: columnas de pcap y tablas numéricas reales, con los mismos métodos, controles y criterio de aceptación; aquí se verá si algo de esto sirve fuera de mis generadores. Después, identificabilidad (con casos de sobreajuste que ahora faltan, p. ej. profundidad 5) y dos lados / operaciones binarias.


## 21. Datos reales: Algex actual vs brotli vs sintetizador experimental (experimento 13)

Código: `src/lab/columns.ts` (extracción mecánica de columnas), `src/lab/realfit.ts` (adaptador al sintetizador congelado + baselines + predictor + residual), `columns.test`/`realfit.test.ts` (9 tests), `scripts/lab-18-real.ts`, `lab-18b-algex-crash.ts`, `lab-18c-aggregate.ts`, `lab-18d-context-predictors.ts`. Pre-registro: `prereg-real.md` (+ adenda 1 de correcciones del arnés). Salidas: `lab-18-real-{p1,p2,n2,rest}-raw.txt`, `lab-18-real-n2b-posthoc-raw.txt`, `lab-18b-algex-crash-raw.txt`, `lab-18d-context-predictors-raw.txt`. Algoritmos congelados (compose `c1898eee`, decimate `309e43af`, encoder `d5bb5aa2`). Nada se integra al encoder.

### Diseño
* **Datos** (lista cerrada antes de mirar): pcaps `smallFlows` (14 261 paquetes) y los primeros 24 MB de `bigFlows` (58 415 paquetes), más los 4 pcaps diminutos del repo; USGS `all_month.csv`; UCI consumo eléctrico (65 536 filas); `tr46/mappingTable.json`. Columnas extraídas por regla mecánica, sin elegir las favorables; barajado de filas como control.
* **Costes comparados** sobre los mismos bytes, todos con los mismos metadatos: B0 brotli-11 de la columna, B1 transpuesta por planos, B2 diferencia, B3 segunda diferencia, Algex `compress(…, "max")`, y S (sintetizador: metadatos + por plano min(modelo verificado, brotli) + 1 bit).
* **Éxito** = S < mejor baseline − 8 bits **y** el modelo reproduce la columna entera. Una fórmula sin ahorro no cuenta.

### Resultado principal (regla literal pre-registrada)
155 columnas: **69 demasiado cortas** (n < 2048: los 4 pcaps del repo), **28 descartadas por la regla** (USGS: 20 de 22, casi todas por decimales largos o texto; UCI: 8 de 9, por el marcador `?` de dato faltante), **58 evaluadas**.
* **Éxitos: 4 de 58**, todos columnas **constantes o casi constantes**: `ip.ver_ihl` y `tcp.urg` (smallFlows), `tcp.urg` y `ip.flags_frag` (bigFlows). Ahorro total **427 bits (53 bytes) sobre 9,8 Mbit: 0,004 %**. Cada constante ahorra ~12 bytes: los que brotli gasta de más en una constante.
* **Ninguna fórmula no trivial** redujo el tamaño real. En 54 de 58 columnas el sintetizador no ganó nada.
* **Cobertura en bytes de archivo**: 0,30 % (smallFlows) y 0,68 % (bigFlows) de los bytes del pcap pertenecen a columnas con "éxito", pero el ahorro real es de decenas de bytes.
* **Falsos positivos**: 0 en las columnas no constantes barajadas. Las "2/25" y "1/29" que imprime el arnés son un **artefacto del control**: una columna constante barajada sigue idéntica, así que no discrimina.
* **Sobreajuste detectado y frenado por la verificación**: 3 planos aceptados con el prefijo y no exactos en la columna completa (p. ej. `tr46`: el byte alto es 0 en todo el prefijo, pero aparecen code points ≥ 0x10000 después). Sin la verificación contra la columna completa habrían sido victorias falsas.

### Tiempos
Sintetizador 1 159 s frente a brotli 59 s y Algex 94 s: **~20×** brotli en conjunto (9× a 99× según el conjunto; una columna de 58 k filas tardó 10 min). Los ms de procesos paralelos están contaminados; la cifra de "trabajo determinista" del arnés **no es fiable**, porque no suma las búsquedas que fallan (devuelven `null`).

### Algex actual
* No baja de brotli en ninguna columna evaluada (típicamente brotli + 1 byte; en columnas diminutas pesa más: 608 bits frente a 104 en una constante).
* **Fallo del codec**: `compress` lanza `RangeError: offset is out of bounds` (`format.ts:488`, `writeChunk`, línea `buf.set(seed, off)`) con 2 de las 7 columnas de UCI (`Sub_metering_1` y `_2`). Es determinista, ocurre en los tres modos (`fast`, `balanced`, `max`), y el prefijo más corto que falla de `Sub_metering_1` mide **112 904 bytes** (112 903 comprime bien). Reproducible con `lab-18b-algex-crash.ts`. No se corrigió (algoritmos congelados). **Conviene arreglarlo aparte**: es un fallo del codec actual, independiente de este experimento.

### Estructuras aproximadas: predictor + residual
* **Por índice** (mínimos cuadrados lineal, cuadrático y por tramos, con residual en brotli): **nunca gana** en datos reales (0 de ~60 columnas); es entre 1,06× y 2,9× peor que el mejor delta. Sí gana ~20 % en la curva sintética suave + ruido (S2), de modo que el arnés puede detectar estructura aproximada cuando existe.
* **Con contexto de flujo** (análisis exploratorio **post hoc**, predictores fijados por conocimiento de protocolo tras ver que los de índice fallan): ahorro sobre el mejor baseline de columna:

| Columna | smallFlows | bigFlows |
|---|---|---|
| `tcp.seq` (último seq + carga útil) | −74,7 % | −61,8 % |
| `ip.id` (último del origen + 1) | −47,9 % | −59,4 % |
| `tcp.ack` (último ack del flujo) | −41,0 % | −38,5 % |

  Total ≈ 38 KB (0,41 %) en smallFlows y ≈ 156 KB (0,65 %) en bigFlows. **Salvedades**: se probó en 2 capturas y 3 columnas; cada predictor depende de otras columnas ya decodificadas (flujo, longitud), así que exige un contenedor columnar con dependencias y no es compresión columna a columna; el coste del predictor se fijó en 256 bits (estimación); se compara con baselines **por columna**, no con brotli/Algex sobre el archivo entero (comparación pendiente); y es un mecanismo distinto del sintetizador algebraico.

### Predicciones (pre-registradas) contrastadas
| # | Predicción | Resultado |
|---|---|---|
| 1 | Nula: ≥ 90 % de columnas con ahorro 0 | **Cumplida**: 54/58 (93 %) |
| 2 | Éxitos solo en constantes, ahorro de pocos bytes | **Cumplida** |
| 3 | 0 falsos positivos en barajadas y S3; S1 éxito; S2 solo el predictor gana | 0 FP y S3 **cumplidas**; **S1 refutada** (limitación del adaptador por planos: acarreos); S2: el predictor gana ~20 % al baseline, incluido B2 |
| 4 | Predictor + residual ≤ 5 % de mejora sobre B2/B3 | Cumplida trivialmente: **no mejora nada** (peor 1,06×–2,9×) |
| 5 | Tiempo ≥ 100× brotli | **Refutada**: ~20× (9×–99×) |
| 6 | Cobertura < 1 % de bytes de pcap | **Cumplida** (0,30 % y 0,68 %), con ahorro real 0,004 % |

### Qué se puede y qué no se puede afirmar
* Se puede: sobre estas columnas reales (cabeceras de red, un sensor, una tabla Unicode), el sintetizador algebraico exacto **no reduce el tamaño real**; el único "ahorro" son 12 bytes por columna constante. No hay evidencia de que sirva en datos cotidianos.
* Se puede: la verificación sobre la columna completa es imprescindible (3 falsos aciertos frenados), y los controles barajados no encuentran falsos positivos en columnas no constantes.
* Se puede: en datos reales de red existe estructura aprovechable (38–75 % en tres campos), pero es **contextual y por estado de flujo**, no una función del índice; requiere otro tipo de modelo.
* No se puede: generalizar fuera de 2 capturas de red, 1 sensor, 1 terremotos (casi sin columnas aptas) y 1 tabla. La cobertura es mala: 69 columnas cortas y 28 descartadas por la regla literal.
* No se puede: afirmar el ahorro de los predictores con contexto sobre el archivo entero, ni contra brotli/Algex del pcap completo; no se hizo.
* Limitación del adaptador: la partición en planos de bytes pierde la estructura aritmética ancha (S1).
* Variante **post hoc** (UCI con `?` como vacío, `lab-18-real-n2b-posthoc-raw.txt`): 7 columnas evaluables, **0 éxitos**, 0 falsos positivos y Algex con excepción en 2.

### Siguiente
Decisión de dirección más que de implementación. Tres caminos, que no se pueden hacer a la vez:
1. **Abandonar el sintetizador algebraico exacto** para datos reales y probar solo los predictores con contexto, empezando por una comparación honesta contra brotli/Algex sobre el pcap entero.
2. **Seguir con identificabilidad y composiciones de dos lados** en generadores sintéticos, sabiendo que no hay evidencia de uso en datos reales.
3. **Arreglar el fallo de Algex** y repetir la evaluación sobre más datos numéricos reales (más conjuntos con columnas aptas).


## 22. Predictores contextuales sobre PCAP completos (experimento 14) y corrección del bug de Algex

Código: `src/lab/pcapcodec.ts` (códec de laboratorio con decodificador real), `pcapcodec.test.ts` (11 tests), `scripts/lab-19-pcap.ts`, `lab-19b-algex-file.ts`, `lab-19c-fetch-blind.ts`, `lab-19d-overhead.ts`. Pre-registro: `prereg-pcap.md` (+ adenda 1 con la congelación y los hashes, escrita **antes** de abrir las capturas ciegas). Salidas: `lab-19-dev-*`, `lab-19-blind-*`, `lab-19d-overhead-raw.txt`. Nada se integra al encoder.

### Camino 3 — bug de Algex (corregido)
`compress` lanzaba `RangeError: offset is out of bounds` (`format.ts:488`). Causa raíz: el addon nativo devuelve `length = 32` con `coeffs` vacío en el tope `BM16_MAX_L` (`c/addon.c:289`), el encoder aceptaba ese candidato (`tryLFSR16` solo rechazaba `L16 > 32`) y `preparedSize` reservaba 0 bytes de semilla mientras `writeChunk` escribía 64. Corrección de una condición en `encoder.ts` (`result.coeffs.length !== L16`): el candidato inconsistente no se genera, sin `try/catch`. Test de regresión `lfsr16-order32.test.ts` (10 tests; 7 fallan sin la corrección, comprobado revirtiendo). Verificación de formato: 87 salidas (29 entradas × 3 modos) idénticas byte a byte antes y después, y las 87 salidas viejas se descomprimen con la versión nueva. Suite completa en verde. **Riesgo abierto**: el off-by-one del C nativo sigue; los órdenes LFSR16 de exactamente 32 quedan sin usar (antes crasheaban).

### Camino 1 — diseño
Códec columnar con decodificador real (reconstrucción byte a byte verificada en **todos** los brazos y archivos). Brazos (todos con brotli-11, ventana 2^24): **W0** brotli del archivo; **W1** Algex `max` sobre el archivo; **W2** columnas por campo (solo *disposición* del protocolo); **W3** + delta genérico (sin protocolo); **W4** + predictores con estado TCP/IP (tiempo combinado, `incl_len`/`orig_len`, `udp.len`, `ip.id` por origen, `tcp.seq` y `tcp.ack` por flujo); **W5** + recomputar checksums IPv4/TCP/UDP. Diseño congelado antes de abrir las capturas ciegas (hashes en la adenda); una sola corrida ciega, en serie.

### Resultados (tamaño respecto de W0; todos exactos)
| Captura | Carga útil | W0 (B) | W1 Algex | W2 col | W3 +gen | W4 +estado | **W5 +checksums** |
|---|---|---|---|---|---|---|---|
| DEV smallFlows | 89 % | 4 639 782 | +0,19 % | −0,61 % | −0,80 % | −2,23 % | **−3,25 %** |
| DEV bigFlows (24 MB) | 83 % | 16 128 428 | no medido | +1,13 % | +0,93 % | −0,68 % | **−1,96 %** |
| **BL1** MAWI 2023 | 0 % | 4 620 741 | +1,02 % | −2,39 % | −3,78 % | −3,88 % | **−3,88 %** † |
| **BL2** MAWI 2019 | 4 % | 5 242 838 | +0,87 % | **+10,41 %** | +7,89 % | −3,05 % | **−16,78 %** |
| **BL3** bigFlows (tramo 200 MB) | 86 % | 17 132 710 | +0,35 % | +0,87 % | +0,74 % | −0,61 % | **−1,65 %** |

† **BL1 no ejercita el conocimiento TCP/IP**: está etiquetada con 802.1Q (VLAN, ethertype 0x8100), que mi analizador no soporta, así que el 100 % de los paquetes cayó a "crudo". Su −3,88 % sale solo de las columnas de registro/Ethernet (tiempos, longitudes, MAC) y del delta genérico. No es evidencia a favor ni en contra de los predictores TCP/IP.

**Mejora neta NI = 1 − W5 / min(W0, W1)**: BL1 3,88 % (†), BL2 16,78 %, BL3 1,65 %. En ningún archivo Algex (W1) mejoró a brotli: es entre 0,35 % y 1,02 % **peor**, y 2–3× más lento.

### Aplicación de la regla previa
* **Éxito primario** (NI ≥ 2 % en las tres): **no se cumple** (BL3 = 1,65 %).
* **Éxito acotado** (NI ≥ 2 % en BL1 y BL2): se cumple **formalmente**, pero BL1 lo cumple por razones ajenas a TCP/IP (†). La evidencia real a favor de los predictores TCP/IP en tráfico de solo cabeceras es **una sola captura** (BL2).
* **Fracaso** (NI < 2 % en BL3 y en BL1 o BL2): no se da.
* **Conclusión**: el resultado es *éxito acotado, con evidencia débil*: útil en tráfico dominado por cabeceras (BL2: −16,8 %), y en tráfico con carga útil la mejora es **consistentemente positiva pero pequeña** (3,25 %, 1,96 %, 1,65 %), por debajo del umbral de 2 % en dos de tres. Según la regla previa **no se sofistica más** este enfoque (no se añade VLAN, ni IPv6 con extensiones, ni más predictores); eso exigiría una decisión nueva.

### Atribución del ahorro: protocolo vs mecanismo (% de W0)
| Escalón | smallFlows | bigFlows dev | BL1 | BL2 | BL3 |
|---|---|---|---|---|---|
| Disposición (W0→W2) | +0,61 | **−1,13** | +2,39 | **−10,41** | **−0,87** |
| Predicción genérica sin protocolo (W2→W3) | +0,20 | +0,19 | +1,39 | +2,52 | +0,12 |
| Estado/semántica TCP/IP (W3→W4) | +1,42 | +1,61 | +0,10 | **+10,94** | +1,35 |
| Álgebra de checksums (W4→W5) | +1,03 | +1,28 | 0,00 | **+13,73** | +1,04 |
(positivo = ahorro; negativo = el escalón empeora).
* **El "mecanismo de predicción" genérico aporta entre 0,1 % y 2,5 %.** Casi todo el ahorro es **conocimiento del protocolo**: estado/semántica + álgebra de checksums suman 2,4–24,7 % frente a 0,1–2,5 % del delta genérico.
* **Una parte grande no es predicción estadística sino cálculo exacto**: los checksums válidos son funciones deterministas de la cabecera y la carga útil (la bandera es 1 y la excepción nunca se escribe). En BL2 son 13,7 puntos de 16,8.
* **La "alternativa sencilla de compresión columnar sin predictores" (W2) no es mejor que brotli**: es peor en 3 de 5 capturas (hasta +10,4 % en BL2). Separar columnas por sí solo pierde el contexto entre campos que brotli aprovecha en el flujo entrelazado; el ahorro aparece solo cuando se añaden predictores con semántica.
* Dos predicciones pre-registradas quedan refutadas por estos datos: la disposición **no** ahorra > 10 % en MAWI (empeora 10,4 % en BL2), y en BL3 los checksums (1,04) **no** superan al estado (1,35).

### Costes
* **Extracción** (análisis de capas): 64–174 ms por 24 MB; despreciable.
* **Codificación**: 40–49 s por 24 MB, **igual o menor que brotli solo** (41–53 s): la carga útil se comprime una sola vez. Algex sobre el archivo: 116–139 s (2,2–3,3× brotli).
* **Decodificación** (mediana de 3): W5 232 ms / 762 ms / 314 ms (BL1/BL2/BL3) frente a brotli 57 / 79 / 114 ms: **2,8×–9,6×** más lenta, pero sub-segundo.
* **Metadatos**: la sobrecarga del contenedor (cabecera + longitudes de 42 flujos) es **94 B en 1,38 MB (0,007 %)**.
* **Determinismo**: dos codificaciones del mismo archivo son idénticas (comprobado en un prefijo de 3 MB).
* **Dependencias de decodificación**: `rec.incl` depende de `ip4.len`/`ip6.plen`; `rec.orig` de `rec.incl`; `udp.len` de las longitudes IP; `ip4.id` de `ip4.src`; `tcp.seq` de (IP origen/destino, puertos, `tcp.off`, longitudes); `tcp.ack` de `tcp.seq` del flujo contrario; los checksums del paquete entero ya ensamblado. Consecuencia: **no hay acceso aleatorio ni decodificación de una columna aislada**; se decodifica el archivo entero en memoria, con estado de flujo sin límite (mapas por flujo).

### Qué se puede y qué no se puede afirmar
* Se puede: sobre archivos completos y con reconstrucción exacta, un códec que conozca TCP/IP bate a brotli-11 en **todas** las capturas comparables (1,65 %–16,78 %), y Algex actual nunca lo hace. Es reproducible en las 5 capturas (también en las de desarrollo), y la codificación es determinista.
* Se puede: el ahorro es casi todo **conocimiento del protocolo** (estado y álgebra de checksums), no mecanismo de predicción.
* Se puede: en tráfico con carga útil la mejora es pequeña (1,65 %–3,25 %) y queda limitada por la carga útil opaca, que no se toca.
* No se puede: afirmar el éxito primario (BL3 no llega al 2 %).
* No se puede: extrapolar el −16,8 % de BL2 a tráfico con carga útil; las dos MAWI tienen la carga útil eliminada y direcciones anonimizadas, y BL1 ni siquiera se analizó (VLAN).
* No se puede: generalizar. Son 3 orígenes distintos (smallFlows/bigFlows de tcpreplay en tres tramos, y dos trazas MAWI); no hay pcapng, VLAN, túneles, QUIC/TLS dominados por carga cifrada fuera de bigFlows, ni IPv6 intenso.
* No se puede: afirmar que no existan baselines mejores. Solo se probó brotli-11 con ventana 2^24 y Algex; no zstd `--long`/xz ni brotli con diccionario.
* Selección de predictor por calidad 5 de brotli (la final es la 11): puede no elegir el mínimo real.

### Decisión
Aplicando la regla previa, **se documenta y se deja de sofisticar**. Si se quisiera aprovechar el resultado, la vía sería un modo PCAP específico (contenedor columnar con dependencias, ~1,6–3 % en tráfico con carga útil, mucho más en tráfico truncado a cabeceras); eso es una decisión de producto, no de este experimento, y no está integrado.
