# Pre-registro — diezmado por módulo m como transformación general (exp. 12, parte 2)

Escrito **antes** de correr cualquier lote ciego. Los parámetros marcados `[J]` se fijan con la calibración de desarrollo (semillas 4001–4003, nunca ciegas) y se completan en la adenda antes de la primera corrida ciega (semillas 5001+). El solver (`compose.ts`) y la capa de diezmado (`decimate.ts`) quedan congelados: se registran sus hashes en cada salida.

## Qué se mide (separado)
Por (clase, módulo m), con los **mismos** 2^16 bytes de entrenamiento partidos en m carriles `y_c(i) = y(m·i + c)` (longitud potencia de 2):
1. **Aceptación** (compresión): todos los carriles con coste < 25 % de min(brotli, crudo) del propio carril.
2. **Exactitud** (generalización): todos los carriles extrapolan sin error a `[L, 2^20/m)`. Es independiente de la aceptación; las dos columnas se publican por separado, y "aceptado y no exacto" es sobreajuste.
3. **Coste en bits**: independiente (suma de carriles + cabecera) y compartido (`shareLanes`, reversible: el script comprueba que cada carril reconstruido evalúa igual).
4. **Trabajo determinista** (unidades del contador) y ms.
5. **Selección hidden-free**: entre los m con todos los carriles aceptados se elige el de menos bits compartidos; luego se mira si lo elegido es exacto (falso positivo si no).

## Teoría que genera las predicciones (dos mecanismos 2-ádicos, §18)
Con n = m·i + c y m = 2^k·u (u impar):
* **M1 (diezmado)**: el bit j de f(n) mod 2^8 depende de n mod 2^(j+1). Sustituir n = m·i + c hace que dependa de i mod 2^(max(0, j+1−k)) → la complejidad 2-ádica j baja exactamente en v₂(m) = k. **La parte impar u no tiene efecto**: i ↦ u·i + c es una biyección de Z/2^t.
* **M2 (nilpotencia)**: (2^k)^e ≡ 0 mod 2^8 cuando k·e ≥ 8, así que el grado efectivo de un polinomio sobre Z/256 en el carril baja. Para k = 4 queda lineal; para k ≥ 8 constante.
* **Cierre**: Beatty + lineal = Beatty (exacto); poly(lineal) = poly; gf2∘afín-en-bits = gf2 con k columnas menos.

## Predicciones

**P1 (cuándo y cuánto ayuda: la ley Δj = v₂(m))**. Sea J(d) el mayor j que el solver (profundidad d de carril) resuelve en G11 **sin** diezmar (m = 1). Entonces `G11 j` se resuelve con módulo m **si y solo si** `j − v₂(m) ≤ J(d)` `[J]`. Consecuencias que se pueden refutar:
  * m impar (3, 5): resuelve exactamente las mismas j que m = 1 (ninguna ganancia).
  * m = 6: igual que m = 2 (la parte 3 no cuenta).
  * m = 2^k: gana exactamente k niveles de j.
  Una sola celda (j, m) que contradiga la ley la refuta; se publican todas.

**P2 (diezmado por 3 y 5 no ayuda, y por qué)**. Para clases ya resueltas con m = 1, el coste por carril con m impar es ≈ el coste entero (sin reducción de grado ni de j); con m = 2^k el coste por carril baja con k. La comparación 3 y 5 vs 2 y 4 es el control de la explicación 2-ádica. Que "también ayude" no refutaría por sí solo la explicación: lo que se pone a prueba es si la **magnitud** coincide con P1.

**P3 (polinomios)**. Para clases cuyo interior es poly (A1, A5, B1, B7): éxito igual que con m = 1; coste por carril no creciente en k (M2). Con compartición, el coste total con m = 2^k es ≤ coste con m = 1 + 40 bits.

**P4 (GF(2))**. Clases xorshift (C, C1 sin el poly): éxito igual; carriles con k columnas menos (−8k bits cada uno); la compartición codifica la constante de carril como `gf2c` (afín en los bits de c).

**P5 (binarias)**. B11 = add(beatty, poly) se resuelve con m = 16 (poly queda lineal → Beatty + lineal = Beatty) incluso con j alto, **y no se resuelve** B10 = xor(beatty, poly) ni C2 = add(poly, gf2) con m ≤ 16: xor de Beatty con un lineal no es una hoja; C2 es add(poly lineal, gf2-afín) no cerrado. Esta es una predicción con riesgo (puede fallar la parte negativa).

**P6 (controles negativos: falsos positivos)**. H (fmix32), R (aleatorio) y T (LCG truncado): **0 carriles aceptados en cualquier m**, y en consecuencia 0 selecciones. Cualquier selección sobre un control es un falso positivo y se cuenta como tal. Para T se espera también 0 porque el carril de un LCG es otro LCG (a^m).

**P7 (compartición)**. En clases con carriles de la misma forma, el coste compartido con m > 1 es menor que el independiente por un factor creciente en m; cuando falla la compartición (campos no polinómicos en c por acarreos, p.ej. el desplazamiento `b'_c` de Beatty) se publica como resultado negativo.

**P8 (identificabilidad mínima)**. Con profundidad de carril 2 no se esperan carriles aceptados no exactos (sobreajuste) con L ≥ 4096; si aparecen, se cuentan como falsos positivos, no se corrigen dentro del lote.

## Reglas
* Semillas: desarrollo 4001–4003; ciegas 5001+ (10 instancias por celda). Ninguna se reusa.
* El solver no se modifica durante el lote ciego. Cualquier cambio posterior se declara y obliga a otro lote.
* Se mide también dentro/fuera de lo diseñado. Condición de salida de esta etapa: **sonda sobre datos numéricos reales antes de construir más solvers**.

---

# Adenda 1 — calibración de desarrollo (semillas 4001–4003), antes de cualquier lote ciego

Salidas: `lab-17-dev-grid-percarril-raw.txt` (regla de aceptación por carril, **descartada**, ver abajo) y `lab-17-dev-families-raw.txt` (regla por total).

## P1 tal como se escribió queda REFUTADA
Con profundidad de carril 2, G11 sin diezmar (m=1) resuelve j ≤ 3 (J=3). La ley "resuelve con m si y solo si j − v₂(m) ≤ 3" coincide en 66 de las 72 celdas de la rejilla G11 (j=0..8 × m∈{1,2,3,4,5,6,8,16}) y **falla** en 6: (j=6, m=4), (j=7, m=4), (j=7, m=8), (j=8, m=4), (j=8, m=8), (j=8, m=16). En todas el solver resolvió 3/3 exactas donde la ley predecía fallo. Todas las celdas con j ≤ 5 coinciden. Se publica tal cual.

## Causa (mecanismo M2 que P1 no integró)
La ley omite el término de nilpotencia. Con k_tot = k + (niveles il2 que el solver aún puede usar en el carril = profundidad de carril 2) niveles de diezmado efectivos:
* los términos de grado e del polinomio quedan multiplicados por (2^k_tot)^e; para el cuadrático e=2 se anulan módulo 256 cuando k_tot ≥ 4;
* con k_tot ≥ 4 la parte polinómica es lineal y **Beatty + lineal = Beatty**, así que una hoja Beatty resuelve **cualquier j**;
* con k_tot < 4 vale la ley de M1: la hoja poly acepta j' = j − k_tot ≤ 1.

## Ley revisada R1 (post hoc: se ajusta a las celdas de desarrollo; se pone a prueba en el lote ciego)
Con profundidad de carril 2 (k_tot = v₂(m) + 2): `G11 j` se resuelve con m **si y solo si** `j − (v₂(m)+2) ≤ 1` **o** `v₂(m)+2 ≥ 4`. Predicciones R1 sobre la rejilla (coinciden con las 72 celdas de desarrollo, por construcción):
* v₂(m)=0 (m=1,3,5): resuelve j ≤ 3.   * v₂(m)=1 (m=2,6): resuelve j ≤ 4.   * v₂(m) ≥ 2 (m=4,8,16): resuelve todo j.
Los dos parámetros (1 y 4) no se ajustaron libremente: salen de "la hoja poly acepta j'≤1" (conocido desde §18) y de 2k ≥ 8. Aun así, la ley se formuló después de ver los datos: su valor probatorio solo cuenta en el lote ciego (semillas 5001+, j ∈ {2,3,4,5,6,7,9,10}, incluyendo j fuera del rango visto).

## Cambio de regla de aceptación (medición, no solver)
La regla por carril (25 % del brotli del propio carril) penalizaba carriles muy compresibles por brotli: G12 j=0 con m=8 daba 1/3 solo por eso, aunque los 3 eran exactos. La descripción almacenada es la compartida completa, así que desde ahora: se **acepta** si `bits compartidos totales < 25 % de min(brotli, crudo)` de los mismos m·L bytes; en el carril solo se corta si ya cuesta >25 % del crudo. El solver no cambia (hash compose `c1898eee`).

## Otros hechos de desarrollo (no predichos)
* La compartición de parámetros es muy rentable cuando hay diezmado par: G11 j=3 pasa de 379 bits (m=1) a 111 (m=8) con ambas exactas; j=2 de 179 a 103 (m=4).
* Con m impar la compartición ayuda poco (G11 j=3, m=5: 1886 → 1470 bits).

---

# Adenda 2 — diseño y predicciones del lote ciego (semillas 5001–5010), escrita antes de correrlo

Hashes congelados: compose.ts=c1898eee ast.ts=48e3ef99 decimate.ts=309e43af hidden-compose.ts=750e168b lab-17-decimation.ts=f508a1cb 

Salidas de desarrollo usadas: `lab-17-dev-families-raw.txt` (regla por total) y `lab-17-b-diag` (diagnóstico, `lab-17b-diagnose.ts`).

## Hallazgos de desarrollo que cambian predicciones (no ciegos)
* **B10 = xor(beatty, poly) SE RESUELVE con m ≥ 8** (2/3 exactas, ~1575 bits independientes, brotli ≈ 32920): la parte negativa de P5 queda **refutada** en desarrollo. La ruta usada es `il2(baff∘poly | baff∘poly)` por carril. Mecanismo **no verificado** (hipótesis: tras k_tot niveles el término polinómico solo toca bits altos y el xor deja de ser un obstáculo).
* **La compartición solo actúa si los carriles tienen la misma forma.** El solver devuelve formas distintas para carriles equivalentes (A1 m=4: `xorc∘poly(3)` en unos carriles y `poly(4)` en otro, porque la constante xor se absorbe de forma no canónica). Es una limitación de la capa de compartición, no del fenómeno matemático. No se arregla en este lote.
* **La regla del 25 % del brotli castiga a las clases muy compresibles** (A1 m=16: 1/3 aceptadas por eso, 3/3 exactas). Se mantiene la regla y se publica la columna "exacto" aparte.

## Diseño
* Semillas 5001–5010 (10 por celda), N = 2^16, profundidad de carril 2, módulos **1, 2, 3, 4, 5, 6, 8, 10, 12, 16** (10 y 12 añadidos para probar que la parte impar no importa: m=10 ≡ m=2 y m=12 ≡ m=4 según R1).
* **Rejillas**: G11 y G12, j ∈ {2, 3, 4, 5, 6, 7, 9, 10} (9 y 10 fuera del rango de desarrollo).
* **Clases**: A1, A3, B1, B7 (poly/Beatty ya resueltas con m=1), B10, B11, B12, C1, C2, X1, y controles H, R, T.
* Estabilidad de mitades (hidden-free) sobre el módulo elegido; se cruza con exactitud.

## Predicciones registradas
Sea v = v₂(m), k_tot = v + 2. Celdas de G11/G12 (j, m):
* **Interior resuelta**: v ≥ 2 (m = 4, 8, 12, 16) con cualquier j; o j ≤ v + 2.  **Esperado: ≥ 8/10 exactas.**
* **Interior no resuelta**: v ≤ 1 y j ≥ v + 4.  **Esperado: ≤ 1/10 exactas.**
* **Frontera**: j = v + 3. No se evalúa (se publica).
* **Violación de R1** = interior resuelta con ≤ 7/10, o interior no resuelta con ≥ 2/10. Se cuentan todas las celdas y se publica el número de violaciones sobre el total (G11 y G12 por separado; G12 no se usó para fijar R1 salvo j=3, 4 en desarrollo).
* **Parte impar irrelevante**: para cada par (m impar-equivalente) m=1/3/5, m=2/6/10 y m=4/12 las tasas deben coincidir en celdas interiores.

Otras clases:
* **H, R, T**: 0 selecciones en cualquier m (falsos positivos = 0).
* **A1, A3, B1, B7**: exactos con m=1 (10/10 esperado); el módulo elegido hidden-free puede ser distinto de 1 solo si ahorra bits; en ningún caso hay selección no exacta.
* **B10**: 0/10 con v ≤ 2 (m = 1, 2, 3, 4, 5, 6, 10, 12) y ≥ 5/10 exactas con v = 3, 4 (m = 8, 16). Esta es la predicción con más riesgo.
* **B11**: ≥ 8/10 exactas con v ≥ 2.
* **C1** (xor(poly, gf2)): sin ganancia con diezmado (el mejor módulo no ahorra más de 10 % de bits vs m=1).
* **C2** (add(poly, gf2)), **X1**: sin resolver con ningún módulo salvo los que ya resolvía m=1 (X1 10/10 en m=1; C2 0/10).
* **B12**: se publica por módulo; no hay ley previa más allá de la analogía con G12.
* **Compartición**: en G11/G12 con j ≥ 4 y m=16, bits compartidos ≤ 0.6 × bits independientes en ≥ 70 % de las instancias.
* **Identificabilidad**: no se espera ninguna selección \"estable pero NO exacta\" (sobreajuste no detectable); cada una se cuenta como fallo de la prueba de mitades.
