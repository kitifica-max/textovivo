// Vocabulario automático de un libro en inglés, sin modelos: cruza el texto del libro con un diccionario abierto inglés→español
// (FreeDict eng-spa, derivado de WikDict/Wiktionary, CC BY-SA 3.0: ver README, «Atribuciones»).
// Por cada palabra del libro que está en el diccionario, genera filas «traducción al español → palabra literal del libro».
// Solo traduce palabras: no inventa sinónimos («liderazgo» no llega a «commander»; «comandante» sí).
//   node scripts/vocabulario-auto.ts <id>            informe del libro
// El diccionario se descarga una vez en data/diccionario/ (ignorado por git) con scripts/descargar-diccionario.sh.
import { readFile } from "node:fs/promises";
import { Paginas } from "../src/schema.ts";
import { normalizar, palabras, type Termino } from "../src/vocabulario.ts";

export type Diccionario = Map<string, string[]>;

/** Lee el TEI de FreeDict: titular en inglés (minúsculas) → traducciones al español. */
export function leerDiccionario(tei: string): Diccionario {
  const d: Diccionario = new Map();
  for (const m of tei.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const orth = m[1].match(/<orth>([^<]+)<\/orth>/)?.[1]?.trim().toLowerCase();
    if (!orth) continue;
    const quotes = [...m[1].matchAll(/<cit type="trans"[^>]*>\s*<quote>([^<]+)<\/quote>/g)].map((x) => x[1].replace(/\([^)]*\)/g, "").trim()).filter((q) => q && q.split(/\s+/).length <= 3);
    if (!quotes.length) continue;
    d.set(orth, [...new Set([...(d.get(orth) ?? []), ...quotes])]);
  }
  return d;
}

// Formas base probables de una palabra del texto («commanders» → «commander»).
const formas = (w: string) => [w, w.replace(/ies$/, "y"), w.replace(/(es|s|ed|ly)$/, ""), w.replace(/ing$/, ""), w.replace(/ed$/, "e"), w.replace(/ing$/, "e")].filter((x, i, a) => x.length >= 3 && a.indexOf(x) === i);

/** Filas para un libro: palabras con contenido del texto que el diccionario sabe traducir. `maxDfRatio` descarta las demasiado comunes. */
export function filasAutomaticas(paginas: { pagina: number; texto: string }[], dic: Diccionario, maxDfRatio = 0.35): Termino[] {
  const primera = new Map<string, number>();
  const df = new Map<string, number>();
  for (const p of paginas) for (const w of new Set(palabras(p.texto))) {
    df.set(w, (df.get(w) ?? 0) + 1);
    if (!primera.has(w)) primera.set(w, p.pagina);
  }
  const filas: Termino[] = [];
  for (const [w, n] of df) {
    if (w.length < 4 || n / paginas.length > maxDfRatio) continue;
    const trad = formas(w).flatMap((f) => dic.get(f) ?? []);
    for (const q of [...new Set(trad)]) filas.push({ termino: q, traduccion: w, pagina: primera.get(w)!, fuente: "diccionario" });
  }
  return filas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  const dic = leerDiccionario(await readFile("data/diccionario/eng-spa.tei", "utf8"));
  const filas = filasAutomaticas(Paginas.parse(JSON.parse(await readFile(`data/libros/${id}/paginas.json`, "utf8"))), dic);
  console.log(`${id}: ${filas.length} filas · ${new Set(filas.map((f) => normalizar(f.traduccion))).size} palabras del libro con traducción`);
}
