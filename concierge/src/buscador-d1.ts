// Buscador de páginas sobre D1 (FTS5, ranking bm25). Implementa Buscador de tools.ts.
import { env } from "cloudflare:workers";
import { filtrarPorUmbral, normalizar, type Buscador, type Coincidencia } from "./tools.ts";

const VACIAS = new Set(
  "como con del las los para pero por que sin sus una uno este esta esto son hay ser muy cual cuando donde mas the and for with how what".split(" ")
);

// desde: primera página que cuenta (se saltan los preliminares: portada e índice le ganarían a los capítulos).
export const buscadorD1 =
  (libro: string, desde = 1): Buscador =>
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
    const comillados = terminos.map((t) => `"${t}"`);
    const consultar = async (match: string) =>
      (
        await env.DB.prepare(
          `SELECT pagina, texto, -bm25(paginas_fts) AS puntuacion
             FROM paginas_fts WHERE paginas_fts MATCH ?1 AND libro = ?2 AND pagina >= ?4
            ORDER BY bm25(paginas_fts) LIMIT ?3`
        )
          .bind(match, libro, Math.max(max, 10), desde)
          .all<{ pagina: number; texto: string; puntuacion: number }>()
      ).results;

    // AND primero (páginas con todos los términos); OR solo como respaldo, marcado como parcial.
    let coincidencia: Coincidencia = "completa";
    let encontrados = await consultar(comillados.join(" "));
    if (!encontrados.length && terminos.length > 1) {
      coincidencia = "parcial";
      encontrados = await consultar(comillados.join(" OR "));
    }
    return filtrarPorUmbral(encontrados).slice(0, max).map((r) => ({ ...r, coincidencia }));
  };
