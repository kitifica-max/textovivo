// Vocabulario de un documento recién indexado (documentos personales y envíos aprobados). Mejor esfuerzo: si la IA falla,
// el documento se busca igual por sus palabras. Para los libros del catálogo se usa scripts/terminos.ts (claude-haiku-5-5).
// Misma regla que allá: la traducción tiene que estar literal en el texto; lo que no aparece se descarta.
import { env } from "cloudflare:workers";
import { validarTerminos, type Candidato } from "./vocabulario.ts";

const MODELO = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_MUESTRAS = 6;

const texto = (r: unknown) => {
  const x = r as { response?: unknown } | string | null;
  return typeof x === "string" ? x : typeof x?.response === "string" ? x.response : "";
};

/** Genera y guarda el vocabulario de un documento. Devuelve cuántos términos quedaron. */
export async function indexarTerminos(libro: string, idioma: string, paginas: { pagina: number; texto: string }[]) {
  if (!env.AI || !paginas.length) return 0;
  // Muestras repartidas por el documento (no se manda todo: costo y tiempo).
  const paso = Math.max(1, Math.floor(paginas.length / MAX_MUESTRAS));
  const muestras = paginas.filter((_, i) => i % paso === 0).slice(0, MAX_MUESTRAS);
  const candidatos: Candidato[] = [];
  for (const m of muestras) {
    try {
      const r = texto(
        await env.AI.run(MODELO, {
          messages: [
            { role: "system", content: `Armás vocabulario de búsqueda. El texto está en ${idioma}. Devolvé SOLO un arreglo JSON de hasta 8 objetos {"termino","traduccion"}: "traduccion" es una palabra o frase de 1 a 4 palabras COPIADA TEXTUALMENTE del texto; "termino" es como la escribiría alguien en español o inglés (sinónimo o traducción). Si no podés copiarla tal cual, no la incluyas.` },
            { role: "user", content: m.texto.slice(0, 3000) }
          ],
          max_tokens: 600,
          temperature: 0
        })
      );
      const json = r.match(/\[[\s\S]*\]/)?.[0];
      if (json) for (const c of JSON.parse(json) as Candidato[]) candidatos.push({ ...c, pagina: m.pagina, fuente: "sinonimo" });
    } catch { /* una muestra que falla no frena a las demás */ }
  }
  const { buenos } = validarTerminos(candidatos, paginas);
  if (!buenos.length) return 0;
  const stmts = buenos.slice(0, 120).map((t) =>
    env.DB.prepare("INSERT OR IGNORE INTO terminos (libro, termino, traduccion, pagina, fuente) VALUES (?, ?, ?, ?, ?)").bind(libro, t.termino, t.traduccion, t.pagina, t.fuente)
  );
  await env.DB.batch(stmts);
  return stmts.length;
}
