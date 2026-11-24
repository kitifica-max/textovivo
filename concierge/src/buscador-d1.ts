// Buscador de páginas sobre D1 (FTS5, ranking bm25). Implementa Buscador de tools.ts.
import { env } from "cloudflare:workers";
import { normalizar, type Buscador } from "./tools.ts";

const VACIAS = new Set(
  "como con del las los para pero por que sin sus una uno este esta esto son hay ser muy cual cuando donde mas the and for with how what".split(" ")
);

export const buscadorD1 =
  (libro: string): Buscador =>
  async (consulta, max) => {
    const terminos = [
      ...new Set(
        normalizar(consulta)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length > 2 && !VACIAS.has(w))
      )
    ].slice(0, 12);
    if (!terminos.length) return [];
    // Cada término entre comillas: FTS5 no interpreta operadores dentro.
    const match = terminos.map((t) => `"${t}"`).join(" OR ");
    const { results } = await env.DB.prepare(
      `SELECT pagina, texto, -bm25(paginas_fts) AS puntuacion
         FROM paginas_fts WHERE paginas_fts MATCH ?1 AND libro = ?2
        ORDER BY bm25(paginas_fts) LIMIT ?3`
    )
      .bind(match, libro, max)
      .all<{ pagina: number; texto: string; puntuacion: number }>();
    return results;
  };
