// Vocabulario por libro (tabla terminos). Dos pasos, los dos con la misma regla: la traducción tiene que estar LITERAL en el texto.
//   node scripts/terminos.ts generar <id>...   pide a claude-haiku-5-5 sinónimos y traducciones ES↔EN → data/libros/<id>/terminos.candidatos.json
//   node scripts/terminos.ts validar <id>...   descarta lo que no aparece en el texto → data/libros/<id>/terminos.json (el que usa catalogo.ts)
//   node scripts/terminos.ts todo <id>...      generar + validar
// La clave de Anthropic se lee de ANTHROPIC_API_KEY o de .secreto-anthropic (nunca se imprime ni se guarda).
// terminos.candidatos.json también se puede escribir a mano: pasa por el mismo filtro.
import { readFile, writeFile } from "node:fs/promises";
import { Paginas } from "../src/schema.ts";
import { validarTerminos, type Candidato } from "../src/vocabulario.ts";

const MODELO = "claude-haiku-5-5";
const leer = async (ruta: string) => JSON.parse(await readFile(ruta, "utf8"));
const existe = (ruta: string) => readFile(ruta).then(() => true, () => false);

type Item = { fuente: string; nombre: string; pagina: number; cita?: string };

/** Lo que tiene el libro y merece vocabulario: glosario, frameworks, checklists y capítulos (con su primera página). */
function elementos(d: any, paginas: { pagina: number; texto: string }[]) {
  const items: Item[] = [];
  for (const g of d.glosario ?? []) items.push({ fuente: "glosario", nombre: g.termino, pagina: g.pagina, cita: g.cita });
  for (const f of d.frameworks ?? []) {
    items.push({ fuente: "framework", nombre: f.nombre, pagina: f.pasos?.[0]?.pagina ?? 1, cita: f.pasos?.[0]?.cita });
    for (const p of f.pasos ?? []) items.push({ fuente: "framework", nombre: `${f.nombre} · ${p.titulo}`, pagina: p.pagina, cita: p.cita });
  }
  for (const c of d.checklists ?? []) items.push({ fuente: "checklist", nombre: c.nombre, pagina: c.items?.[0]?.pagina ?? 1, cita: c.items?.[0]?.cita });
  for (const s of d.indice ?? []) items.push({ fuente: "capitulo", nombre: s.titulo, pagina: s.pagina_inicio, cita: paginas.find((p) => p.pagina === s.pagina_inicio)?.texto.slice(0, 500) });
  return items;
}

async function clave() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  if (await existe(".secreto-anthropic")) return (await readFile(".secreto-anthropic", "utf8")).trim();
  throw new Error("Falta la clave: definí ANTHROPIC_API_KEY o creá concierge/.secreto-anthropic (está en .gitignore).");
}

async function preguntar(prompt: string, key: string) {
  const base = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
    body: JSON.stringify({ model: MODELO, max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
  });
  if (!r.ok) throw new Error(`Anthropic respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { content: { type: string; text?: string }[] };
  return j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

const promptDe = (idioma: string, titulo: string, lote: Item[]) => `Armás el vocabulario de búsqueda de un libro. Libro: «${titulo}», escrito en ${idioma === "en" ? "inglés" : idioma}.
Quien consulta puede escribir en español o en inglés, con sinónimos o palabras distintas a las del libro (p. ej. «liderazgo» cuando el texto dice «commander»).
Para cada elemento devolvé hasta 5 filas {"termino","traduccion","pagina","fuente"}:
- "termino": como lo diría quien consulta (español o inglés, sinónimos, variantes).
- "traduccion": una palabra o frase corta (1 a 4 palabras) COPIADA TEXTUALMENTE de la cita o del texto del elemento, en el idioma del libro. Si no podés copiarla tal cual, no la incluyas: se descarta lo que no esté literal en el libro.
- "pagina" y "fuente": los del elemento.
Respondé SOLO con un arreglo JSON.

Elementos:
${JSON.stringify(lote)}`;

async function generar(id: string) {
  const d = (await leer("data/catalogo.json")).find((x: any) => x.id === id);
  if (!d) throw new Error(`${id}: no está en data/catalogo.json (corré node scripts/catalogo.ts)`);
  const paginas = Paginas.parse(await leer(`data/libros/${id}/paginas.json`));
  const items = elementos(d, paginas);
  const key = await clave();
  const candidatos: Candidato[] = [];
  for (let i = 0; i < items.length; i += 20) {
    const texto = await preguntar(promptDe(d.idioma, d.titulo, items.slice(i, i + 20)), key);
    const json = texto.match(/\[[\s\S]*\]/)?.[0];
    if (!json) { console.warn(`  lote ${i / 20 + 1}: sin JSON, se omite`); continue; }
    candidatos.push(...(JSON.parse(json) as Candidato[]));
  }
  await writeFile(`data/libros/${id}/terminos.candidatos.json`, JSON.stringify(candidatos, null, 1) + "\n");
  console.log(`${id}: ${candidatos.length} candidatos de ${MODELO}`);
}

export async function validar(id: string) {
  const paginas = Paginas.parse(await leer(`data/libros/${id}/paginas.json`));
  const candidatos: Candidato[] = await leer(`data/libros/${id}/terminos.candidatos.json`);
  const { buenos, descartados } = validarTerminos(candidatos, paginas);
  await writeFile(`data/libros/${id}/terminos.json`, JSON.stringify(buenos, null, 1) + "\n");
  console.log(`${id}: ${buenos.length} términos válidos, ${descartados.length} descartados (la traducción no está literal en el texto)`);
  for (const x of descartados.slice(0, 15)) console.log(`    ✗ «${x.termino}» → «${x.traduccion}»`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modo, ...ids] = process.argv.slice(2);
  if (!["generar", "validar", "todo"].includes(modo) || !ids.length) {
    console.error("Uso: node scripts/terminos.ts <generar|validar|todo> <id>...");
    process.exit(1);
  }
  for (const id of ids) {
    if (modo !== "validar") await generar(id);
    if (modo !== "generar") await validar(id);
  }
}
