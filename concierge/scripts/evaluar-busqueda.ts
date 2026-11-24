// Evalúa la búsqueda de un libro con consultas escritas ANTES de ver resultados. Mismos umbrales para todos los libros.
//   node scripts/evaluar-busqueda.ts            (todos los libros que tienen consultas en data/evaluacion/)
//   node scripts/evaluar-busqueda.ts <id> --sin-vocabulario   (línea base: sin la tabla terminos)
// Cada consulta dice qué páginas son correctas: las de un rango o las que contienen ciertas palabras literales del texto.
// Usa el buscador en memoria (mismas etapas que D1; el ranking exacto de FTS5/bm25 puede diferir un poco).
import { readdir, readFile } from "node:fs/promises";
import { Destilado, Paginas } from "../src/schema.ts";
import { buscarConcepto, buscadorMemoria, crearLibro } from "../src/tools.ts";
import { derivarTerminos, posicionLiteral } from "../src/vocabulario.ts";

export const UMBRALES = { recall5: 0.8, primero: 0.6, ceroResultados: 0.1 };
type Consulta = { q: string; paginas?: [number, number]; contiene?: string[]; nota?: string };

const leer = async (r: string) => JSON.parse(await readFile(r, "utf8"));

export async function evaluar(id: string, conVocabulario = true) {
  const consultas: Consulta[] = await leer(`data/evaluacion/${id}.json`);
  const catalogo = (await leer("data/catalogo.json")).find((x: { id: string }) => x.id === id);
  const paginas = Paginas.parse(await leer(`data/libros/${id}/paginas.json`));
  // El vocabulario sale del destilado, igual que en la ingesta (solo las filas con traducción literal sirven para buscar).
  const terminos = conVocabulario ? derivarTerminos(catalogo, paginas).filter((t) => t.verificado) : [];
  const libro = crearLibro(Destilado.parse(catalogo), buscadorMemoria(paginas, terminos), async () => terminos);
  const buenas = (c: Consulta) =>
    new Set(paginas.filter((p) => (c.paginas ? p.pagina >= c.paginas[0] && p.pagina <= c.paginas[1] : (c.contiene ?? []).some((w) => posicionLiteral(p.texto, w) >= 0))).map((p) => p.pagina));

  const filas = [];
  const listas = new Map<string, string[]>();
  for (const c of consultas) {
    const r: any = await buscarConcepto(libro, c.q, 5);
    const paginasDev: number[] = (r.resultados ?? []).map((x: any) => x.pagina_inicio);
    const ok = buenas(c);
    if (r.sugerencias) listas.set(c.q, r.sugerencias);
    filas.push({ q: c.q, n: paginasDev.length, en5: paginasDev.some((p) => ok.has(p)), primero: paginasDev.length > 0 && ok.has(paginasDev[0]), pags: paginasDev.join(","), coincidencia: r.coincidencia ?? (r.sugerencias ? "sugerencias" : "—") });
  }
  const total = filas.length;
  const m = {
    recall5: filas.filter((f) => f.en5).length / total,
    primero: filas.filter((f) => f.primero).length / total,
    ceroResultados: filas.filter((f) => f.n === 0).length / total
  };
  // Dos consultas sin resultados con la misma lista de sugerencias: solo válido como último recurso.
  const repetidas = [...listas.entries()].filter(([q, l], i, a) => a.some(([q2, l2], j) => j !== i && q !== q2 && JSON.stringify(l) === JSON.stringify(l2))).map(([q]) => q);
  return { id, filas, m, repetidas, aprobado: m.recall5 >= UMBRALES.recall5 && m.primero >= UMBRALES.primero && m.ceroResultados <= UMBRALES.ceroResultados };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sin = args.includes("--sin-vocabulario");
  const ids = args.filter((a) => !a.startsWith("--"));
  const todos = ids.length ? ids : (await readdir("data/evaluacion")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  for (const id of todos) {
    const r = await evaluar(id, !sin);
    console.log(`\n== ${id} ${sin ? "(sin vocabulario)" : ""}`);
    for (const f of r.filas) console.log(`  ${f.en5 ? "✓" : "✗"} ${f.primero ? "1º" : "  "} ${f.q.padEnd(40)} ${String(f.n).padStart(2)} res · p.${f.pags || "—"} · ${f.coincidencia}`);
    const pc = (x: number) => `${Math.round(x * 100)} %`;
    console.log(`  recall@5 ${pc(r.m.recall5)} (≥ ${pc(UMBRALES.recall5)}) · primero correcto ${pc(r.m.primero)} (≥ ${pc(UMBRALES.primero)}) · cero resultados ${pc(r.m.ceroResultados)} (≤ ${pc(UMBRALES.ceroResultados)}) → ${r.aprobado ? "APRUEBA" : "NO aprueba"}`);
    if (r.repetidas.length) console.log(`  sugerencias repetidas entre consultas distintas: ${r.repetidas.join(" | ")}`);
  }
}
