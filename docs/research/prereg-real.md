# Pre-registro — evaluación sobre datos reales (exp. 13)

Escrito **antes** de descargar los datos nuevos y de mirar ninguna columna. Algoritmos congelados: solver `compose.ts`, capa `decimate.ts`, y el codec Algex tal como está (`compress(...)`). Se registran los hashes en la salida. Nada se integra al encoder.

## Conjuntos de datos (lista cerrada, elegida antes de ver nada)
**PCAP (columnas por paquete, en orden de captura)**
* P1 `smallFlows.pcap` (tcpreplay, tráfico mixto real, ~14 k paquetes).
* P2 `bigFlows.pcap`, solo los primeros 24 MB (un prefijo de un pcap clásico sigue siendo válido).
* P3–P6 los cuatro pcaps del repo (`http.cap`, `dhcpv6_1.pcap`, `sip-rtp-opus-hybrid.pcap`, `STP_UplinkFast.pcapng`). Son diminutos: **se incluyen a propósito** para que la cobertura (columnas demasiado cortas) cuente en los denominadores.

**Numéricos auténticos**
* N1 USGS `all_month.csv` (terremotos reales; instantánea guardada con SHA-256).
* N2 UCI "Individual household electric power consumption" (serie real de un sensor), primeras 65 536 filas de datos.
* N3 `node_modules/tr46/lib/mappingTable.json` (tabla Unicode real).

Ningún conjunto se añade ni se quita después de ver resultados. Si una descarga falla, se documenta y se reporta como ausente.

## Extracción de columnas (mecánica, sin selección)
* **PCAP clásico**: todos los campos de cabecera de longitud fija de cada capa presente (registro pcap: ts_sec, ts_usec, caplen, origlen; Ethernet; IPv4; TCP; UDP; ICMP), una columna por campo y capa, en orden de captura, sin filtrar flujos. Paquetes que no tengan la capa se omiten de esa columna.
* **CSV**: toda columna cuyas celdas no vacías sean todas numéricas. Enteros → entero; decimales con ≤ 6 decimales → entero escalado por 10^d; el resto se descarta y **se cuenta** (cobertura).
* **JSON array de arrays**: cada posición donde todas las filas tienen un número.
* Ancho w = bytes mínimos que contienen el rango, **sin signo** tras restar el mínimo de la columna (el mínimo se guarda como metadato: coste 64 bits), little-endian. Columna = secuencia de n valores.
* Mínimo n = 2048. Más cortas: no se evalúan y se cuentan como "demasiado corta".

## Adaptador al sintetizador (fuera del solver)
Cada columna se separa en w planos de bytes (LSB primero). Cada plano: prefijo de longitud 2^⌊log2 n⌋ (potencia de 2) para buscar; el modelo hallado se **verifica contra el plano completo** (los n valores). Un modelo que solo ajusta el prefijo es un **falso positivo** (se cuenta). Se prueba m ∈ {1, 2, 4, 8, 16} (capa de diezmado) con la regla de selección sin oculto del exp. 12; se evalúa la profundidad 2.

## Costes (todos completos y decodificables)
Para cada columna, bits totales de:
* **B0**: brotli-11 de los bytes de la columna (little-endian, valores contiguos).
* **B1**: brotli-11 de los planos de bytes concatenados (transposición).
* **B2**: brotli-11 de los planos de la **diferencia** (módulo 2^(8w)).
* **B3**: brotli-11 de los planos de la **segunda diferencia**.
* **A**: Algex actual, `compress(bytes, "max")`, longitud completa de la salida.
* **S** (sintetizador): metadatos (w, n, mínimo: 64 + gamma) + por plano min(bits del modelo [fórmulas + parámetros + cabecera de diezmado, ya incluyen compartición] , bits de brotli del plano) + 1 bit de indicador por plano. Si el modelo no reproduce el plano completo, ese plano cuesta su brotli.
Baseline = min(B0, B1, B2, B3, A). La transposición y las diferencias van como baselines **porque** pueden explicar por sí solas cualquier mejora que no sea de la fórmula.

## Éxito (definición previa)
Una columna es un **éxito** solo si `S < baseline − 8` bits **y** el modelo reproduce toda la columna (verificado) y el round trip se comprueba. Encontrar una fórmula que no baja el tamaño real **no** es éxito (se reporta aparte como "fórmula sin ahorro").

## Métricas
Ahorro neto (bits y %) por columna y total; tiempo de búsqueda (ms y unidades de trabajo); **cobertura** (% de bytes de columnas numéricas con éxito; % de columnas demasiado cortas / no representables); **falsos positivos** (controles); y hallazgos negativos.

## Controles
* **Barajado**: cada columna real con las filas permutadas (misma distribución marginal, sin estructura de orden). Cualquier éxito aquí es un falso positivo.
* **Sintéticas de validación del arnés** (se rotulan como sintéticas, no cuentan como datos reales): S1 polinomio exacto en el índice; S2 polinomio + ruido uniforme en ±2 (estructura **aproximada**); S3 bytes aleatorios.

## Estructuras aproximadas (análisis aparte, sin tocar los algoritmos)
Donde el sintetizador no halla nada o no gana: se diagnostica **por qué** (entropía de planos, ¿monótona?, ¿pasos constantes?, ¿ruido?) y se evalúa un **predictor + residual estadístico**: mínimos cuadrados lineal y cuadrático sobre el índice (y por tramos de 256 valores), con coeficientes cuantizados (cuentan sus bits) y el residual en zigzag, por planos, comprimido con brotli-11. Se compara con B2/B3 y con el baseline. Esto es un **análisis**, no un componente: no se añade al solver.

## Predicciones (hipótesis nula explícita)
1. **Nula principal**: en ≥ 90 % de las columnas reales el ahorro neto sobre el baseline es 0 (el sintetizador no gana nada). Brotli, la transposición y las diferencias ya capturan casi toda la estructura de datos reales.
2. Los éxitos, si existen, serán columnas **casi constantes o con pasos regulares** (campos fijos de cabecera, contadores regulares) donde el ahorro absoluto es de pocos bytes: el sintetizador "encuentra fórmulas" que brotli ya comprimía casi gratis.
3. Falsos positivos en las columnas barajadas y en S3: **0**. S1: éxito; S2: el sintetizador exacto **no** lo gana, el predictor + residual sí le gana al baseline de brotli sin diferencias, pero **no necesariamente** a B2/B3.
4. Predictor + residual estadístico: mediana de mejora ≤ 5 % sobre el mejor de B2/B3 en columnas reales.
5. Tiempo de búsqueda: ≥ 100× el de brotli por columna.
6. **Cobertura en bytes de archivo completo**: < 1 % de los bytes de los pcaps (las columnas de cabecera son una fracción pequeña del archivo; la carga útil es opaca).

## Reglas
Algoritmos congelados durante la evaluación; todo resultado negativo se conserva; ninguna columna se excluye por "no parecer favorable"; los datos no se modifican. Cualquier cambio posterior se declara y obliga a repetir.

---

# Adenda 1 — correcciones del arnés, hechas ANTES de procesar ningún dato real

Descubiertas al validar el arnés con las columnas sintéticas (`ONLY="S sintéticas"`); ninguna depende de resultados sobre datos reales.
1. **Metadatos en los baselines.** El coste S ya incluía metadatos (64 bits del mínimo + gamma(n) + gamma(w)); B0–B3 y A no, lo que penalizaba al sintetizador en ~80 bits sin motivo (todos necesitan mínimo, n y w para reconstruir la columna). Desde ahora `baseline = min(B0,B1,B2,B3,A) + META`, y el predictor + residual también carga gamma(n)+gamma(w).
2. **S2 rediseñada.** La S2 original (polinomio módulo 2^16 más ruido) no es un caso de "estructura aproximada" para ningún predictor suave (el desbordamiento rompe cualquier ajuste). Se reemplaza por `round(1000 + 2.5·i + 0.0004·i²) + ruido uniforme ±2` sin desbordamiento. Con ella el predictor + residual cuadrático gana ~20 % al baseline y el sintetizador exacto no halla nada (comportamiento esperable).
3. **Predicción 3 (S1 "éxito") REFUTADA en el arnés.** S1 = 3 + 5i + 11i² módulo 2^16: el plano bajo se halla (36 bits), el plano alto no (depende de acarreos; ≈ j = 8), y B3 (segunda diferencia + brotli) cuesta 184 bits. **Limitación real del adaptador por planos de bytes**: las secuencias aritméticas anchas pierden su estructura al partirse en planos.
4. **Tiempo.** El sintetizador tardó 84 s en una columna ruidosa de 2 planos (S2). Se reparte la carga en procesos paralelos por conjunto; el **trabajo determinista** (unidades) es la métrica de coste reportada con fiabilidad, y los ms de procesos concurrentes se declaran contaminados.
