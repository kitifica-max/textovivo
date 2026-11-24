// Arma lo que consume el worker a partir de data/libros/<id>/:
//   data/catalogo.json            destilados de los libros publicables (se importa en el worker)
//   data/semilla/<id>.sql         páginas para cargar en D1 (paginas_fts)
// Cada libro: meta.json (+ indice.json + extras.json opcional) o un destilado.json completo.
// Falla si alguna cita no existe tal cual en su página: no se publica nada inventado.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { Destilado, Paginas } from "../src/schema.ts";
import { citasInvalidas } from "../src/tools.ts";

const leer = async (ruta: string) => JSON.parse(await readFile(ruta, "utf8"));
const existe = (ruta: string) => readFile(ruta).then(() => true, () => false);

const ids = (await readdir("data/libros", { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
await mkdir("data/semilla", { recursive: true });

const catalogo: Destilado[] = [];
let errores = 0;
for (const id of ids) {
  const dir = `data/libros/${id}`;
  const paginas = Paginas.parse(await leer(`${dir}/paginas.json`));
  let bruto: unknown;
  let publicar = true;
  if (await existe(`${dir}/destilado.json`)) {
    bruto = await leer(`${dir}/destilado.json`);
  } else {
    const meta = await leer(`${dir}/meta.json`);
    publicar = meta.publicar !== false;
    const extras = (await existe(`${dir}/extras.json`)) ? await leer(`${dir}/extras.json`) : {};
    bruto = {
      id,
      titulo: meta.titulo,
      autor: meta.autor,
      descripcion: meta.descripcion ?? "",
      idioma: meta.idioma ?? "es",
      indice: await leer(`${dir}/indice.json`),
      glosario: [],
      frameworks: [],
      checklists: [],
      ...extras
    };
  }
  const d = Destilado.parse(bruto);
  const malas = citasInvalidas(d, paginas);
  if (malas.length) {
    errores += malas.length;
    console.error(`✗ ${id}: ${malas.length} citas que no están en el texto`);
    malas.slice(0, 5).forEach((m) => console.error(`    ${m}`));
    continue;
  }
  if (!publicar) {
    console.log(`– ${id}: cargado pero NO publicable (meta.publicar = false)`);
    continue;
  }
  catalogo.push(d);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const sql = [
    `DELETE FROM paginas_fts WHERE libro = ${q(id)};`,
    ...paginas.map((p) => `INSERT INTO paginas_fts (texto, libro, pagina) VALUES (${q(p.texto)}, ${q(id)}, ${p.pagina});`)
  ].join("\n");
  await writeFile(`data/semilla/${id}.sql`, sql + "\n");
  console.log(`✓ ${id}: ${paginas.length} páginas, ${d.frameworks.length} frameworks, ${d.checklists.length} checklists, ${d.glosario.length} términos`);
}
await writeFile("data/catalogo.json", JSON.stringify(catalogo));
if (errores) process.exit(1);
