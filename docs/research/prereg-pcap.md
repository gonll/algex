# Pre-registro — predictores contextuales sobre archivos PCAP completos (exp. 14)

Escrito **antes** de descargar ninguna captura ciega y antes de implementar el códec de laboratorio. Camino 1 acordado tras el exp. 13: allí un predictor con contexto de flujo ahorraba 38–75 % en 3 columnas, pero (a) era un análisis por columna, (b) se eligió post hoc, (c) nunca se comparó con brotli ni Algex sobre el **archivo entero**, y (d) no se reconstruía el archivo. Este experimento corrige eso. Todo es laboratorio: **nada se integra al encoder**; los algoritmos algebraicos quedan en pausa.

## Qué se construye (módulo `src/lab/pcapcodec.ts`, sin acceso a datos ciegos al diseñarlo)
Un códec **con decodificador real**: `decode(encode(file)) == file` byte a byte, verificado en cada archivo y cada brazo. Se aceptan pcap clásicos (microsegundos/nanosegundos, little/big endian) con enlace Ethernet (1) o IP crudo (101). Cada paquete se parte en capas: enlace → red (IPv4 / IPv6 / resto) → transporte (TCP / UDP / resto) → carga útil. Cada campo de cabecera de longitud fija es una columna (anchura completa; las opciones IPv4/TCP y la carga útil son flujos de bytes). Cualquier paquete no analizable, bytes finales truncados y cabecera global van crudos; si el archivo no es un pcap soportado, el códec cae a brotli (y eso se cuenta).

## Brazos (todos sobre el archivo completo, mismo contenedor, mismo brotli-11 con ventana 2^24)
| Brazo | Qué añade | Conocimiento que usa |
|---|---|---|
| **W0** | brotli-11 del archivo entero | ninguno |
| **W1** | Algex actual `compress(file,"max")` (tras corregir el bug, ver abajo) | ninguno |
| **W2** `col` | partir en columnas por campo + brotli por flujo (sin predictores) | **disposición** del protocolo |
| **W3** `col+gen` | W2 + por columna el mejor de {crudo, delta, delta de segundo orden} | ninguno más (mecanismo genérico de predicción) |
| **W4** `ctx` | W3 + predictores con estado: tiempo combinado delta; `incl_len` desde longitud IP; `orig_len` desde `incl_len`; `udp.len` y longitud IPv6 desde la longitud de cabecera; `ip.id` por origen (último + 1); `tcp.seq` por flujo (último seq + carga útil + SYN/FIN); `tcp.ack` por flujo (último ack, o siguiente seq esperado del sentido contrario) | **semántica y estado** de TCP/IP |
| **W5** `ctx+ck` | W4 + recomputar checksums IPv4, TCP y UDP (residuo contra el valor esperado) | **álgebra** de checksums |

La codificación de cada columna: `r = (v − pred) mod 2^(8w)` en w planos de bytes; el codificador elige, por columna y **por tamaño real comprimido**, el mejor predictor del menú fijo del brazo y guarda un byte con su identificador. Contenedor: tabla de longitudes de flujos y banderas, todo contado.

**Atribución del ahorro** (lo pedido): `W0−W2` = conocer la disposición; `W2−W3` = predicción genérica (sin protocolo); `W3−W4` = estado/semántica TCP/IP; `W4−W5` = álgebra de checksums. Más un brazo de control `W3` con el mismo menú genérico: cualquier ahorro de W4 y W5 sobre W3 es **conocimiento del protocolo**, no "mecanismo de predicción" (que ya está en W3).

## Datos
**Desarrollo** (se puede mirar y arreglar el códec): `smallFlows.pcap` (9,4 MB) y los primeros 24 MB de `bigFlows.pcap`, ya vistos en el exp. 13.
**Ciegos** (una sola corrida, sin ajustar nada después), lista cerrada y elegida antes de bajarlos:
* **BL1** MAWI muestra F, 2023-01-01 14:00 (prefijo de ≈ 24 MB descomprimidos). Tráfico de backbone **solo cabeceras** (carga útil eliminada, direcciones anonimizadas).
* **BL2** MAWI muestra F, 2019-06-01 14:00 (prefijo de ≈ 24 MB). Misma advertencia.
* **BL3** `bigFlows.pcap`, un tramo de 24 MB empezando lejos del prefijo de desarrollo (≈ byte 200 000 000, resincronizado al primer límite de paquete válido). **Semi-ciega**: mismo origen que el desarrollo; es la única con carga útil real.
Las MAWI no representan tráfico con carga útil. Un resultado ahí **no** se extrapola; BL3 es la única evidencia con carga útil, y es débil (una captura).

## Congelación
El menú de predictores y el códec se congelan **antes** de abrir BL1–BL3 (hash SHA-256 registrado en el crudo). Durante el desarrollo solo se permite añadir predictores definidos a priori por conocimiento de protocolo y corregir errores; cada adición se declara en una adenda con el hash. Después de la corrida ciega no se cambia nada; si algo cambia, obliga a otro conjunto ciego.

## Métricas
Tamaño (bytes) por brazo; mejora neta **NI = 1 − tamaño(W5) / min(tamaño(W0), tamaño(W1))**; ahorro atribuido por escalón; tiempos de codificación y decodificación (mediana de 3 ejecuciones, proceso aislado) frente a brotli y a Algex; verificación de reconstrucción exacta; dependencias (orden de decodificación y qué columnas necesita cada predictor); costes de extracción (tiempo de análisis aparte del de compresión); metadatos (bytes de contenedor); fracción de paquetes que cayeron a "crudo".

## Criterio de éxito (previo)
* **Éxito primario**: NI ≥ 2 % en **las tres** capturas ciegas **y** reconstrucción exacta en todas.
* **Éxito acotado**: NI ≥ 2 % solo en las capturas dominadas por cabeceras (BL1, BL2). Se reportaría como "útil solo en tráfico truncado a cabeceras".
* **Fracaso**: NI < 2 % en BL3 y en BL1 o BL2 → se documenta y **no se sigue sofisticando** el enfoque.
Si no hay mejora reproducible (el éxito primario no se cumple), se documenta el resultado y no se añaden predictores. El éxito acotado, si ocurre, se reporta tal cual con su alcance, y tampoco se sofistica sin una decisión nueva.

## Predicciones (hipótesis explícitas)
1. **La disposición sola (W0→W2) gana > 10 % en MAWI** (casi todo son cabeceras) y **< 2 % en BL3** (la carga útil domina y brotli ya la comprime igual en un flujo aparte).
2. **La predicción genérica (W2→W3) aporta < 2 %** en todos los archivos: delta de columnas sin semántica no es lo que explica nada.
3. **Casi todo el ahorro de W4/W5 es conocimiento del protocolo y no mecanismo**: en BL3, `W4→W5` (checksums) es mayor que `W3→W4` (estado/semántica). Los checksums IPv4 y TCP/UDP son funciones deterministas (16 bits de entropía por paquete que se vuelven 0), mientras que el estado de flujo sobre un archivo ya comprimido por brotli aporta menos.
4. En MAWI (truncado) los checksums TCP/UDP **no** se pueden recomputar por falta de carga útil: ahí solo el checksum IPv4 cuenta.
5. **NI en BL3 < 2 %** (la carga útil domina): el éxito primario **no se cumplirá**.
6. Tiempo de codificación 3×–15× el de brotli solo; decodificación 1×–5×. Algex(file) ≈ brotli + 1 byte (como en columnas) y mucho más lento en archivos de 24 MB.
7. Reconstrucción exacta en todos los brazos y archivos; fracción de paquetes crudos < 5 % en las capturas Ethernet/IPv4.

## Reglas
Todo resultado se conserva, incluidos los negativos. No se toca ningún predictor tras ver BL1–BL3. No se compara contra variantes con ventana de brotli más débil. La corrección del bug de Algex (camino 3) se hace antes de medir W1; el cambio no puede alterar bytes de salida de entradas que ya comprimían bien.

---

# Adenda 1 — congelación, resultados de desarrollo y bug de Algex (escrita ANTES de abrir BL1–BL3)

**Hashes congelados**: pcapcodec.ts=599fe553 lab-19-pcap.ts=a291c3fa lab-19b-algex-file.ts=145aa56e encoder.ts=fa624381 

## Estado de las capturas ciegas
Descargadas con `scripts/lab-19c-fetch-blind.ts` (24 MB cada una, recortadas a paquetes completos) y **no abiertas con el códec**. Solo se comprobó el encabezado: las tres son pcap clásico, Ethernet, little-endian, microsegundos. BL1 296 553 paquetes (MAWI 2023), BL2 340 593 paquetes (MAWI 2019), BL3 49 544 paquetes (bigFlows, tramo desde el byte 200 000 000, resincronizado en el desplazamiento 861).

## Bug de Algex (camino 3)
Corregido antes de medir W1, con un cambio de una condición en `src/codec/encoder.ts` (`tryLFSR16` rechaza `coeffs.length !== L16`; el addon nativo devuelve `length = 32` con `coeffs` vacío en el tope `BM16_MAX_L`, `c/addon.c:289`). Test de regresión `src/codec/lfsr16-order32.test.ts` (10 tests, 7 fallan sin la corrección: verificado revirtiendo temporalmente). La línea base de 87 archivos comprimidos antes/después es byte a byte idéntica, y los 87 archivos viejos siguen descomprimiéndose. Riesgo abierto: el off-by-one del addon sigue en el C nativo (no se recompiló); los órdenes LFSR16 exactamente 32 quedan sin usar.

## Desarrollo (smallFlows, 9,4 MB, archivo completo)
| Brazo | Bytes | vs W0 | Exacto |
|---|---|---|---|
| W0 brotli-11 (lgwin 24) | 4 639 782 | — | — |
| W1 Algex max | 4 648 479 | +0,19 % | sí |
| W2 col | 4 611 635 | −0,61 % | sí |
| W3 col+gen | 4 602 478 | −0,80 % | sí |
| W4 ctx | 4 536 408 | −2,23 % | sí |
| W5 ctx+ck | 4 488 760 | −3,25 % | sí |
Atribución: disposición 0,61 %, genérico 0,20 %, estado/semántica 1,42 %, checksums 1,03 %. La carga útil es el 89,4 % del archivo y no se toca (4 395 619 B en todos los brazos). **NI en desarrollo = 3,25 %.**
Tiempos: brotli 15,7 s; W5 12,5 s de codificación (la selección con calidad 5 domina); Algex 46,8 s; decodificación W5 111 ms vs brotli 42 ms.

## Predicciones afectadas por el desarrollo (no se modifican, solo se anotan)
* **Predicción 3 (checksums > estado en BL3)**: en desarrollo ocurre lo contrario (estado 1,42 % > checksums 1,03 %). Se mantiene tal cual y se evalúa en BL3.
* **Predicción 5 (NI en BL3 < 2 %)**: el desarrollo da 3,25 % sobre una captura con 89 % de carga útil; es plausible que BL3 supere el 2 %. Se mantiene tal cual.
* **Predicción 6**: la codificación W5 resultó más rápida que brotli solo, no 3–15× más lenta (la carga útil se comprime una vez en cada caso y el brazo no añade un segundo pase de q11 sobre ella). Se anota, no se corrige.

## Cambios al diseño durante el desarrollo
Ninguno tras congelar: el menú de predictores es el que figura en la tabla de brazos. Los predictores ctx son los definidos antes de abrir los datos de desarrollo, y no se añadió ninguno. Las capturas ciegas se evalúan **una sola vez** con `lab-19b-algex-file.ts` (W1) y `lab-19-pcap.ts` (W0, W2–W5), secuencialmente (tiempos limpios).
