// Convierte un .txt de Project Gutenberg en data/paginas.json (páginas lógicas)
// e imprime el índice para data/destilado.json.
// Uso: node scripts/gutenberg-paginas.ts fuentes/libro.txt ["^Chapter ([IVXLC]+)\. (.+)$"]
//   - Quita la cabecera y el pie de Gutenberg, y los párrafos entre [corchetes]
//     (notas del traductor), para quedarse con el texto del autor.
//   - Como un .txt no tiene páginas, arma páginas lógicas de ~1.500 caracteres
//     sin cortar párrafos.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [ruta, patron = "^Chapter ([IVXLC]+)\\. (.+)$"] = process.argv.slice(2);
if (!ruta) {
  console.error('Uso: node scripts/gutenberg-paginas.ts libro.txt ["regex de capítulo"]');
  process.exit(1);
}
const MAX_PAGINA = 1500;

const crudo = (await readFile(ruta, "utf8")).replace(/\r\n/g, "\n");
const cuerpo = crudo.split(/^\*\*\* START OF .*$/m)[1]?.split(/^\*\*\* END OF .*$/m)[0] ?? crudo;

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
const regexCapitulo = new RegExp(patron, "m");
const partes = cuerpo.split(new RegExp(`(${patron})`, "m"));

const capitulos: { titulo: string; parrafos: string[] }[] = [];
for (let i = 0; i < partes.length; i++) {
  const m = partes[i].match(regexCapitulo);
  if (!m || partes[i] !== m[0]) continue;
  const texto = partes[i + m.length] ?? ""; // el split mete los grupos capturados entre medio
  // Las notas de Gutenberg no siempre cierran o abren el corchete, así que:
  // un párrafo que empieza con número de versículo o "(n)" siempre es del autor;
  // uno que termina en "]" sin abrirlo es la cola de una nota.
  let enNota = false;
  const parrafos: string[] = [];
  for (const p of texto.split(/\n\s*\n/)) {
    const t = p.replace(/\s+/g, " ").replace(/_/g, "").trim();
    if (!t) continue;
    if (/^(\d+[.,\s]|\(\d+\))/.test(t)) enNota = false;
    if (t.startsWith("[")) enNota = true;
    const colaDeNota = !enNota && !t.includes("[") && t.endsWith("]");
    if (!enNota && !colaDeNota) {
      const limpio = t.replace(/\s*\[[^\]]*\]/g, "").trim();
      if (limpio) parrafos.push(limpio);
    }
    if (enNota && t.endsWith("]")) enNota = false;
  }
  capitulos.push({ titulo: `Chapter ${m[1]}. ${titulo(m[2])}`, parrafos });
}

const paginas: { pagina: number; texto: string }[] = [];
const indice: { titulo: string; nivel: number; pagina_inicio: number; pagina_fin: number }[] = [];
for (const c of capitulos) {
  const inicio = paginas.length + 1;
  let actual = "";
  for (const p of c.parrafos) {
    if (actual && actual.length + p.length + 1 > MAX_PAGINA) {
      paginas.push({ pagina: paginas.length + 1, texto: actual });
      actual = "";
    }
    actual = actual ? `${actual} ${p}` : p;
  }
  if (actual) paginas.push({ pagina: paginas.length + 1, texto: actual });
  indice.push({ titulo: c.titulo, nivel: 1, pagina_inicio: inicio, pagina_fin: paginas.length });
}

await writeFile(join(import.meta.dirname, "../data/paginas.json"), JSON.stringify(paginas, null, 1) + "\n");
console.error(`${capitulos.length} capítulos, ${paginas.length} páginas → data/paginas.json`);
console.log(JSON.stringify(indice, null, 2));
