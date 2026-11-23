// Extrae el texto de un PDF por página y lo guarda en data/paginas.json.
// Uso: npm run paginas -- ruta/al/libro.pdf [desfase]
//   desfase: cuántas páginas del PDF van antes de la página 1 impresa (portada, índice...).
//   Así las citas usan el número de página que ve el lector en su libro.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const [ruta, desfaseTexto = "0"] = process.argv.slice(2);
if (!ruta) {
  console.error("Uso: npm run paginas -- ruta/al/libro.pdf [desfase]");
  process.exit(1);
}
const desfase = Number(desfaseTexto);

const pdf = await getDocumentProxy(new Uint8Array(await readFile(ruta)));
const { text } = await extractText(pdf, { mergePages: false });

const paginas = text
  .map((t, i) => ({
    pagina: i + 1 - desfase,
    texto: t
      .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2") // une palabras cortadas con guion al final de línea
      .replace(/\s+/g, " ")
      .trim()
  }))
  .filter((p) => p.pagina >= 1 && p.texto);

const destino = join(import.meta.dirname, "../data/paginas.json");
await writeFile(destino, JSON.stringify(paginas, null, 1) + "\n");
console.log(`${paginas.length} páginas con texto → data/paginas.json`);
if (paginas.length === 0) console.log("No hay texto extraíble: el PDF parece escaneado.");
