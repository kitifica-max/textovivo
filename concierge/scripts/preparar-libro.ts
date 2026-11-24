// Convierte fuentes/<id>/fuente.txt en data/libros/<id>/paginas.json (páginas lógicas)
// y propone el índice de capítulos.
// Uso: node scripts/preparar-libro.ts <id>        (lee scripts/libros.json)
//      node scripts/preparar-libro.ts <id> --ver  (solo imprime los títulos detectados)
import { mkdir, readFile, writeFile } from "node:fs/promises";

type Config = {
  id: string;
  patron?: string; // regex (flag m) de línea que abre un capítulo
  desde?: string; // el texto del libro empieza en la primera línea que cumple esto
  hasta?: string; // y termina en la primera línea (después de «desde») que cumple esto
};

const [id, modo] = process.argv.slice(2);
const config = (JSON.parse(await readFile("scripts/libros.json", "utf8")) as Config[]).find((c) => c.id === id);
if (!config) throw new Error(`«${id}» no está en scripts/libros.json`);

const MAX_PAGINA = 1500;
let crudo = (await readFile(`fuentes/${id}/fuente.txt`, "utf8")).replace(/\r\n?/g, "\n");
crudo = crudo.split(/^\*\*\* START OF .*$/m)[1]?.split(/^\*\*\* END OF .*$/m)[0] ?? crudo;
if (config.desde) {
  const i = crudo.search(new RegExp(config.desde, "m"));
  if (i < 0) throw new Error(`No encontré «desde» en ${id}`);
  crudo = crudo.slice(i);
}
if (config.hasta) {
  const m = crudo.slice(1).search(new RegExp(config.hasta, "m"));
  if (m >= 0) crudo = crudo.slice(0, m + 1);
}

// Párrafos: bloques separados por línea en blanco; saltos simples se vuelven espacio.
// Une palabras cortadas con guion al final de línea (texto de OCR).
const parrafos = crudo
  .split(/\n\s*\n/)
  .map((p) =>
    p
      .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
      .replace(/_/g, "")
      .replace(/\s+/g, " ")
      .trim()
  )
  .filter((p) => p && !/^\[(Illustration|Footnote|Transcriber)/i.test(p));

const regex = config.patron ? new RegExp(config.patron) : null;
const titulos: { titulo: string; parrafo: number }[] = [];
parrafos.forEach((p, i) => {
  if (!regex) return;
  const m = p.length <= 140 && p.match(regex);
  if (m) titulos.push({ titulo: p, parrafo: i });
});
// Descarta los títulos del índice inicial: los que tienen otro título a menos de 4 párrafos.
for (let k = titulos.length - 2; k >= 0; k--)
  if (titulos[k + 1].parrafo - titulos[k].parrafo < 4) titulos.splice(k, 1);

if (modo === "--ver") {
  console.log(`${parrafos.length} párrafos, ${titulos.length} títulos`);
  for (const t of titulos.slice(0, 80)) console.log(`  ${t.parrafo}: ${t.titulo}`);
  process.exit(0);
}

// Páginas lógicas de ~1.500 caracteres sin cortar párrafos (un párrafo largo se corta por oraciones).
const paginas: { pagina: number; texto: string }[] = [];
const inicioDePagina = new Map<number, number>(); // párrafo → página donde empieza
let actual = "";
const cerrar = () => {
  if (actual) paginas.push({ pagina: paginas.length + 1, texto: actual.trim() });
  actual = "";
};
parrafos.forEach((p, i) => {
  const esTitulo = titulos.some((t) => t.parrafo === i);
  if (esTitulo) cerrar(); // cada capítulo empieza página nueva
  if (esTitulo) inicioDePagina.set(i, paginas.length + 1);
  const trozos = p.length > MAX_PAGINA ? (p.match(/[^.!?…]+[.!?…]+["”')\]]*\s*|[^.!?…]+$/g) ?? [p]) : [p];
  for (const t of trozos) {
    if (actual && actual.length + t.length + 1 > MAX_PAGINA) cerrar();
    actual += (actual && !actual.endsWith(" ") ? (actual.endsWith("\n") ? "" : trozos.length > 1 ? "" : "\n\n") : "") + t;
  }
});
cerrar();

if (titulos.length === 0) titulos.push({ titulo: "Texto completo", parrafo: 0 });
const indice = titulos.map((t, k) => {
  const inicio = inicioDePagina.get(t.parrafo) ?? 1;
  const sig = titulos[k + 1] ? (inicioDePagina.get(titulos[k + 1].parrafo) ?? paginas.length + 1) : paginas.length + 1;
  return { titulo: t.titulo, nivel: 1, pagina_inicio: inicio, pagina_fin: Math.max(inicio, sig - 1) };
});

await mkdir(`data/libros/${id}`, { recursive: true });
await writeFile(`data/libros/${id}/paginas.json`, JSON.stringify(paginas));
await writeFile(`data/libros/${id}/indice.json`, JSON.stringify(indice, null, 1));
console.log(`${id}: ${paginas.length} páginas, ${indice.length} capítulos`);
