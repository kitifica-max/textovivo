// Buscador de páginas sobre D1 (FTS5, ranking bm25). Implementa Buscador de tools.ts.
// Etapas (vocabulario.ts): palabras tal cual → raíces → vocabulario del libro (traducciones y sinónimos) → cualquiera (respaldo).
// D1 no documenta el tokenizer porter (solo FTS5 y fts5vocab), así que el stemming es propio: raíz + prefijo («lead»*).
import { env } from "cloudflare:workers";
import { filtrarPorUmbral, type Buscador } from "./tools.ts";
import { aplicarDesignadas, ENTRADA_DESIGNADA, matchFts, planDeBusqueda, type Termino } from "./vocabulario.ts";

/** Vocabulario del libro (tabla terminos). Pocas filas por libro: una lectura por consulta, indexada por libro. */
export async function cargarTerminosD1(libro: string): Promise<Termino[]> {
  try {
    const { results } = await env.DB.prepare("SELECT termino, traduccion, pagina, fuente FROM terminos WHERE libro = ?").bind(libro).all<Termino>();
    return results;
  } catch {
    return []; // si la tabla aún no existe (migración pendiente), se busca solo por las palabras escritas
  }
}

// desde: primera página que cuenta (se saltan los preliminares: portada e índice le ganarían a los capítulos).
export const buscadorD1 =
  (libro: string, desde = 1): Buscador =>
  async (consulta, max) => {
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

    for (const etapa of planDeBusqueda(consulta, await cargarTerminosD1(libro))) {
      const encontrados = (await consultar(matchFts(etapa))).filter(Boolean);
      const elegidos = aplicarDesignadas(
        etapa,
        filtrarPorUmbral(encontrados),
        // Páginas señaladas que la búsqueda por palabras no trajo: se leen aparte (hasta 3, solo las que cuentan).
        () => [],
        max
      );
      const faltan = etapa.inyectar ? (etapa.paginas ?? []).filter((pg) => pg >= desde && !elegidos.some((e) => e.pagina === pg)).slice(0, Math.max(0, max - elegidos.length)) : [];
      if (faltan.length) {
        const mejor = Math.max(1, ...encontrados.map((e) => e.puntuacion));
        const { results } = await env.DB.prepare(`SELECT pagina, texto FROM paginas_fts WHERE libro = ?1 AND pagina IN (${faltan.map(() => "?").join(",")})`).bind(libro, ...faltan).all<{ pagina: number; texto: string }>();
        elegidos.push(...results.map((r) => ({ ...r, puntuacion: mejor * ENTRADA_DESIGNADA })));
        elegidos.sort((a, b) => b.puntuacion - a.puntuacion);
      }
      if (!elegidos.length) continue;
      return elegidos.map((r) => ({ ...r, coincidencia: etapa.etiqueta, piezas: etapa.piezas, usados: etapa.usados }));
    }
    return [];
  };
