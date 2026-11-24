# Cambios a la búsqueda de Textifika

Estado: propuesta. Basada en la prueba del 24/11/2026 sobre `arte-de-la-guerra` (12 llamadas al conector en producción) y en la lectura de `src/buscador-d1.ts` y `src/tools.ts`.

## 1. Qué mostró la prueba

| Consulta | Idioma | Resultado | Observación |
|---|---|---|---|
| liderazgo | ES | 0 resultados | El libro está en inglés |
| lider | ES | 0 resultados | Idem |
| estrategias de ataque | ES | 0 resultados | Idem |
| conocer al enemigo y a ti mismo | ES | 0 resultados | Idem |
| leadership | EN | 0 resultados | El texto dice *commander* y *general*: sin sinónimos |
| attack by stratagem | EN | 10 resultados | El primero (cap. XI, p. 36) habla de terreno; el concepto está en cap. III |
| know the enemy and know yourself | EN | Correcto en 1.º y 2.º lugar | Frase exacta del libro |
| commander | EN | Relevante en 1.º lugar | |
| framework "Conocer al rival y a uno mismo" | ES | `verificado: true`, 4 pasos con cita | Las citas coinciden con el texto |
| citar_fuente "a leader who lacks courage…" | EN | Cita real, cap. IV, p. 11 | Encaja solo a medias con la afirmación |

Conclusión: la verificación de citas funciona. La búsqueda falla en vocabulario, idioma y umbral de relevancia.

## 2. Causas en el código

- **`buscador-d1.ts`: MATCH con OR sin umbral.** Cualquier página que contenga una sola palabra de la consulta entra en el resultado. Por eso aparecen páginas de ruido como primer resultado.
- **Sin sinónimos ni variantes.** `normalizar` quita tildes y pasa a minúsculas, pero no hay stemming ni expansión. "leadership" no encuentra "commander".
- **Idioma.** La lista `VACIAS` es fija y mezcla español e inglés. Una consulta en español solo tiene palabras que no existen en el texto inglés, y el resultado es cero. No hay ningún puente de traducción.
- **`citarFuente` elige por solapamiento de palabras**, no por relevancia. Toma una sola página (`buscar(afirmacion, 1)`) y la oración con más palabras en común.
- **`buscarConcepto` con glosario por subcadena.** `t.includes(q)` con consultas de 4 letras o más puede activar un término del glosario que no corresponde.
- **`elegir` (frameworks y checklists)** cae en "si el libro tiene uno solo, devolverlo" cuando no hay coincidencias. Esto oculta la falta de vocabulario: devuelve el único framework aunque la consulta no tenga nada que ver.

## 3. Cambios requeridos

1. **Umbral de relevancia** en `buscadorD1`. Devolver solo páginas con puntuación ≥ 50 % de la mejor. Si ninguna pasa, `buscarConcepto` responde "sin resultados", no una lista de ruido.
2. **AND antes que OR.** Buscar primero páginas que contengan todos los términos. Usar OR solo como respaldo y marcar la respuesta con `coincidencia: "parcial"`.
3. **Vocabulario por libro.** En la ingesta (con la IA de Cloudflare, Workers AI; sin proveedor externo), generar `terminos.json` con sinónimos y traducciones ES↔EN por framework, checklist y capítulo. Guardarlo en una tabla `terminos(libro, termino, pagina)` en D1 e indexarlo en FTS. Antes de buscar, expandir la consulta con esos términos.
4. **Stemming.** Evaluar el tokenizador `porter` de FTS5 para el texto inglés y un truncado de sufijos propio para español. [verificar] soporte en D1 antes de implementar.
5. **Respuesta cuando la consulta no entra en el vocabulario.** Devolver `sugerencias` con términos del libro en su idioma (sacados de `terminos`), en lugar de cero resultados sin explicación.
6. **Glosario por palabra completa.** Reemplazar `t.includes(q)` por comparación de palabras enteras.
7. **`citarFuente` por relevancia.** Buscar con la consulta expandida, tomar las 3 mejores páginas, elegir la oración con mayor puntuación BM25 y devolver hasta 3 candidatos si la diferencia es pequeña.
8. **`elegir` sin fallback silencioso.** Si ningún nombre o palabra coincide, devolver la lista de disponibles, sin devolver el único item.

## 4. Lo que no cambia

- `citasInvalidas` y la regla de que toda cita publicada debe existir en su página.
- `MAX_CARACTERES`, `MAX_PASAJE` y `MAX_CITA` (límites de tokens y de extracción).
- `notaPaginas`: la aclaración de que las páginas son lógicas, no de la edición impresa.
- El destilado (`destilado.json`) y su revisión humana.

## 5. Estándar de aceptación (igual para todos los libros)

Antes de correr la prueba, por libro:
- Al menos 30 consultas, escritas antes de ver resultados, en el idioma del libro, en español, con sinónimos y con sin acentos.
- Cada consulta tiene la página o el capítulo esperado.

Umbrales propuestos, a calibrar con los tres primeros libros, pero iguales para todos:
- recall@5 ≥ 80 %.
- Primer resultado correcto ≥ 60 %.
- Consultas con cero resultados ≤ 10 %.
- Toda consulta sin resultados devuelve `sugerencias`.

Pruebas de regresión obligatorias:
- Las 12 consultas de la prueba del 24/11. Las cuatro en español deben devolver resultados tras la expansión de términos.
- `citasInvalidas(destilado, paginas)` debe devolver lista vacía para cada libro publicado.
- `npm test` (`src/tools.test.ts`) debe pasar. No he leído este archivo; revisar si ya cubre umbral y expansión.

## 6. Orden de implementación

1. Umbral y AND (cambios 1 y 2): cambian solo `buscador-d1.ts`. Son la mejora más barata.
2. Respuesta sin resultados y sugerencias (cambios 5 y 8).
3. Vocabulario por libro (cambio 3): requiere cambio en la ingesta y en el esquema D1.
4. Stemming y citas por relevancia (cambios 4 y 7).
