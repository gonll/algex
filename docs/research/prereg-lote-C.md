# Pre-registro del lote C (escrito ANTES de ejecutarlo)

Motor: `src/lab/compose.ts` con el control de búsqueda corregido (una hoja se acepta sin explorar capas solo si cuesta ≤ el costo mínimo de una composición, `MIN_COMPOSED_BITS` = 27 bits, calculado del códec). Se congela tras el lote A de desarrollo; el hash se imprime en la cabecera de cada salida. Semillas del lote C: 2001+ (A: 1–10, B: 1001–1010). Presupuesto 8 s por instancia, N = 65 536, 10 instancias por clase (5 en el experimento de profundidad).

Criterios (idénticos al lote B): **aceptada** = costo < 25 % de min(brotli-11, crudo); **descubierta** = aceptada y exacta en TODOS los índices de [N, 2²⁰); **exacta no aceptada** = exacta en [N, 2²⁰) pero con costo ≥ umbral (comprime poco).

## Teoría que se contrasta (§18)
j = s − v₂(a). El número de coeficientes de Mahler mod 256 de ⌊(a·n+b)/2^s⌋ es 9·2^(j−1)+1 (j ≥ 1), independiente de a y b (medido: 2, 10, 19, 37, 73); P∘f cuesta M(j)+2^(j−1). El diezmado por 2^k lo reduce a j−k. La hoja polinómica acepta ≤ 12 coeficientes ⇒ solo entra j' ≤ 1.

## Predicciones
- **P1 (rejilla G11/G12, profundidad 3):** descubiertas con j ≤ 3 en ≥ 9/10 de las instancias; j = 4 en la frontera (el costo de 8 carriles × ~80 bits puede superar el umbral: se predice exactas pero posiblemente no aceptadas); **j ≥ 5: 0/10 aceptadas** (ningún falso positivo).
- **P2 (profundidad):** con maxDepth = 4 y 5 el límite exacto se desplaza a j ≤ 5 y j ≤ 6, pero la representación (2^k carriles × ~80 bits) **no se acepta por costo** (≥ umbral). Es decir, G11 j = 5 con profundidad 4: se predice "exacta no aceptada".
- **P3 (diseñadas ya vistas: B1, B2, B4, B8, B14, X1):** ≥ 90 % descubiertas (B4: aceptadas ≥ 90 %, algunas con tabla literal). **B3 y X2: ≥ 50 %** (los degenerados con r = 7 siguen fallando).
- **P4 (diseñadas nuevas: D1, D3):** D1 ≥ 90 %; D3 ≥ 50 % (incertidumbre: grado 3 en el byte).
- **P5 (fuera de diseño: B5, B9, B10, C1, C2):** ≤ 20 % descubiertas en B5 y B9; ≤ 10 % en B10, C1 y C2. Los pocos aciertos deben explicarse por periodicidad 2-ádica, no por composición.
- **P6 (controles H, R, T):** 0 aceptadas.
- **P7 (tiempo):** mediana < 10 s por instancia en las clases diseñadas.

Si una predicción falla se reporta tal cual; no se reajusta el motor dentro del lote C.

---

# Adenda: pre-registro del lote D (escrita ANTES de ejecutarlo; semillas 3001+, motor `compose=2ce8c5ee`)

Cambios del motor desde el lote C (todos post-hoc y declarados): (1) `il2` se explora con cota branch-and-bound (`LB_IL2`) en vez de "solo si no hay hoja". `il2Gate: "legacy"` reproduce el lote C. Hechos conocidos antes del lote D: en el lote A la corrección baja 49/50 → 47/50 y multiplica los tiempos (A2 77 ms → 12,7 s); en la rejilla de C (post-hoc) j=2/3 pasan de 0/7 a 7/9 (G11) y de 0/3 a 10/10 (G12), con 4 sobreajustes en G11.

Predicciones (contra la teoría de dos mecanismos: M1 el diezmado reduce j; M2 el diezmado anula grados altos, Beatty + lineal = Beatty):
- **D1 (rejilla, profundidad 3):** j ≤ 1: 10/10 en G11 y G12. j = 2, 3, 4: ≥ 7/10 descubiertas en G11 y ≥ 8/10 en G12. Sobreajustes (aceptadas no exactas): ≤ 3 por celda y solo en G11 con rutas que usan hojas Beatty. j ≥ 5 (5, 6, 8): ≤ 2/10 descubiertas por celda.
- **D2 (diseñadas): B1, B2, B8, B14, X1, D1 ≥ 80 %**; B4 aceptadas ≥ 80 %; B3, X2, D3 ≥ 40 %.
- **D3 (fuera de diseño):** B5 ≤ 20 %, B9 ≤ 10 %, B10 ≤ 10 %, C2 ≤ 10 %. **C1 (xor de poly y gf2) ≥ 80 %** por el cierre del ANF bajo XOR.
- **D4 (controles H, R, T):** 0 aceptadas.
- **D5 (tiempo):** la corrección de `il2` aumenta las medianas respecto del lote C; se reporta sin ajustar.
