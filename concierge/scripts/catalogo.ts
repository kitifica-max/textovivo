// Arma lo que consume el worker a partir de data/libros/<id>/:
//   data/catalogo.json            destilados de los libros publicables (se importa en el worker)
//   data/semilla/<id>.sql         páginas para cargar en D1 (paginas_fts)
// Cada libro: meta.json (+ indice.json + extras.json opcional) o un destilado.json completo.
// Falla si alguna cita no existe tal cual en su página: no se publica nada inventado.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { Destilado, Paginas } from "../src/schema.ts";
import { citasInvalidas } from "../src/tools.ts";
import { validarTerminos, type Candidato } from "../src/vocabulario.ts";
import { resumen, validar } from "./validar-libro.ts";

const leer = async (ruta: string) => JSON.parse(await readFile(ruta, "utf8"));
const existe = (ruta: string) => readFile(ruta).then(() => true, () => false);

const ids = (await readdir("data/libros", { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
await mkdir("data/semilla", { recursive: true });

const catalogo: Destilado[] = [];
const controles: Awaited<ReturnType<typeof validar>>[] = [];
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
      paginacion: meta.paginacion ?? "logica",
      indice: await leer(`${dir}/indice.json`),
      glosario: [],
      frameworks: [],
      checklists: [],
      ...extras
    };
  }
  const d = Destilado.parse(bruto);
  const malas = citasInvalidas(d, paginas);
  const registro = await validar(id, d); // compuertas: escribe data/libros/<id>/control.json
  controles.push(registro);
  console.log(resumen(registro));
  if (!registro.aprobado) {
    errores += 1;
    console.error(`  → ${id} NO se publica: falló una compuerta (${malas.length} citas inválidas)`);
    continue;
  }
  if (!publicar) {
    console.log(`– ${id}: cargado pero NO publicable (meta.publicar = false)`);
    continue;
  }
  catalogo.push(d);
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  // Vocabulario del libro (opcional): se vuelve a validar acá; si algo ya no está literal en el texto, el libro no se publica.
  let filasTerminos: string[] = [];
  if (await existe(`${dir}/terminos.json`)) {
    const { buenos, descartados } = validarTerminos(await leer(`${dir}/terminos.json`) as Candidato[], paginas);
    if (descartados.length) {
      errores += 1;
      console.error(`  → ${id}: ${descartados.length} términos del vocabulario no están literales en el texto (corré node scripts/terminos.ts validar ${id})`);
      continue;
    }
    filasTerminos = [
      `DELETE FROM terminos WHERE libro = ${q(id)};`,
      ...buenos.map((t) => `INSERT INTO terminos (libro, termino, traduccion, pagina, fuente) VALUES (${q(id)}, ${q(t.termino)}, ${q(t.traduccion)}, ${t.pagina}, ${q(t.fuente)});`)
    ];
  }
  const sql = [
    `DELETE FROM paginas_fts WHERE libro = ${q(id)};`,
    ...paginas.map((p) => `INSERT INTO paginas_fts (texto, libro, pagina) VALUES (${q(p.texto)}, ${q(id)}, ${p.pagina});`),
    ...filasTerminos
  ].join("\n");
  await writeFile(`data/semilla/${id}.sql`, sql + "\n");
}
await writeFile("data/catalogo.json", JSON.stringify(catalogo));
// Fecha en que cada libro entró al catálogo (el panel marca «Nuevo» los de las últimas 2 semanas). Vacío = ya estaba.
const rutaPub = "data/publicaciones.json";
const publicaciones: Record<string, string> = (await existe(rutaPub)) ? await leer(rutaPub) : {};
const hoy = new Date().toISOString().slice(0, 10);
const nuevos = catalogo.map((d) => d.id).filter((id) => !(id in publicaciones));
for (const id of nuevos) publicaciones[id] = hoy;
await writeFile(rutaPub, JSON.stringify(publicaciones, null, 1) + "\n");
if (nuevos.length) console.log(`Libros nuevos en el catálogo (${hoy}): ${nuevos.join(", ")}`);
await writeFile("data/controles.json", JSON.stringify(controles.map(({ libro, fecha, aprobado, paginacion, paginas, capitulos, controles: c }) => ({ libro, fecha, aprobado, paginacion, paginas, capitulos, controles: Object.fromEntries(Object.entries(c).map(([k, x]) => [k, `${x.ok ? "ok" : x.nivel}: ${x.detalle}`])) })), null, 1) + "\n");
if (errores) process.exit(1);
