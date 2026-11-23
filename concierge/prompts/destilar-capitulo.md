# Prompt: destilar un capítulo (H-1, a mano con Claude)

Usalo en Claude, **un capítulo por conversación**. Pegá debajo el texto de las páginas de ese capítulo copiado de `data/paginas.json`, con su número de página.

---

Vas a destilar un capítulo de un libro para convertirlo en herramientas que una IA consulta mientras alguien trabaja.

**Reglas:**
1. Extraé solo lo que el autor propone de forma explícita. No infieras metodologías que el autor no presenta como tales.
2. Preferí pocos elementos confiables antes que muchos dudosos.
3. Mantené el idioma original del texto.
4. Cada elemento lleva `pagina` y `cita`. La `cita` es una frase **copiada carácter por carácter** del texto de esa página (de 5 a 40 palabras). No la parafrasees, no corrijas errores, no unas frases de páginas distintas.
5. Si el capítulo no tiene frameworks, checklists o términos, devolvé listas vacías.
6. Respondé solo con JSON válido, sin texto antes ni después.

**Qué buscar:**
- `frameworks`: metodologías con pasos en orden (método, proceso, modelo, "primero... después...").
- `checklists`: recomendaciones que se pueden usar para revisar un trabajo ("asegurate de...", "evitá...", "siempre...").
- `glosario`: términos que el autor define.

**Formato exacto:**

```json
{
  "glosario": [
    { "termino": "", "definicion": "", "pagina": 0, "cita": "" }
  ],
  "frameworks": [
    {
      "nombre": "",
      "resumen": "",
      "verificado": false,
      "pasos": [
        { "orden": 1, "titulo": "", "descripcion": "", "pagina": 0, "cita": "" }
      ]
    }
  ],
  "checklists": [
    {
      "nombre": "",
      "contexto": "",
      "verificado": false,
      "items": [
        { "texto": "", "pagina": 0, "cita": "" }
      ]
    }
  ]
}
```

**Texto del capítulo** (formato `[p. N] texto`):

[pegar aquí]

---

Después de cada capítulo:
1. Sumá las listas a `data/destilado.json`.
2. Corré `npm test`. Si alguna cita no aparece en su página, el test la muestra: corregila copiándola del texto, o borrá el elemento.
3. Cuando revises un elemento y confirmes que es correcto, cambiá `verificado` a `true`.
