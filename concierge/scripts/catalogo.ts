// Arma lo que consume el worker a partir de data/libros/<id>/:
//   data/catalogo.json            destilados de los libros publicables (se importa en el worker)
//   data/semilla/<id>.sql         páginas para cargar en D1 (paginas_fts)
// Cada libro: meta.json (+ indice.json + extras.json opcional) o un destilado.json completo.
// Falla si alguna cita no existe tal cual en su página: no se publica nada inventado.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { Destilado, Paginas } from "../src/schema.ts";
import { citasInvalidas } from "../src/tools.ts";
import { construirVocabulario, normalizar, type Candidato, type FilaTermino } from "../src/vocabulario.ts";
import { filasAutomaticas, leerDiccionario, type Diccionario } from "./vocabulario-auto.ts";
import { resumen, validar } from "./validar-libro.ts";

const leer = async (ruta: string) => JSON.parse(await readFile(ruta, "utf8"));
const existe = (ruta: string) => readFile(ruta).then(() => true, () => false);

const ids = (await readdir("data/libros", { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
await mkdir("data/semilla", { recursive: true });

// Diccionario abierto inglés→español (sh scripts/descargar-diccionario.sh): vocabulario automático para los libros en inglés.
const dic: Diccionario | null = (await existe("data/diccionario/eng-spa.tei")) ? leerDiccionario(await readFile("data/diccionario/eng-spa.tei", "utf8")) : null;
if (!dic) console.warn("AVISO: sin data/diccionario/eng-spa.tei; los libros en inglés quedan sin vocabulario automático (sh scripts/descargar-diccionario.sh).");

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
      atribucion: meta.atribucion ?? "",
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
  // Vocabulario del libro (sin modelos): lo derivado del destilado (nombre y descripción en español → texto entre paréntesis como traducción,
  // capítulos incluidos) + data/libros/<id>/vocabulario.json (sinónimos escritos y revisados por una persona).
  // La traducción solo se guarda si aparece literal en el texto; si no, queda sin traducción y marcada (verificado = 0).
  // Una fila de vocabulario.json que ya no está literal en el texto es un error: el libro no se publica hasta corregirla.
  const manual: Candidato[] = (await existe(`${dir}/vocabulario.json`)) ? await leer(`${dir}/vocabulario.json`) : [];
  const vocab = construirVocabulario(d, paginas, manual);
  if (vocab.descartados.length) {
    errores += 1;
    console.error(`  → ${id} NO se publica: ${vocab.descartados.length} filas de vocabulario.json no están literales en el texto (p. ej. «${vocab.descartados[0].termino}» → «${vocab.descartados[0].traduccion}»)`);
    continue;
  }
  // Libros en inglés: se suma la traducción automática de sus palabras (diccionario abierto). Lo curado (derivado/manual) manda sobre lo automático.
  const filasVocab: FilaTermino[] = [...vocab.filas];
  if (dic && d.idioma === "en") {
    const hay = new Set(filasVocab.map((f) => `${normalizar(f.termino)}|${normalizar(f.traduccion)}`));
    for (const f of filasAutomaticas(paginas, dic)) if (!hay.has(`${normalizar(f.termino)}|${normalizar(f.traduccion)}`)) filasVocab.push({ ...f, verificado: true });
  }
  const valores = filasVocab.map((t) => `(${q(id)}, ${q(t.termino)}, ${q(normalizar(t.termino))}, ${q(t.traduccion)}, ${t.pagina}, ${q(t.fuente)}, ${t.verificado ? 1 : 0})`);
  const filasTerminos = [`DELETE FROM terminos WHERE libro = ${q(id)};`];
  for (let i = 0; i < valores.length; i += 50)
    filasTerminos.push(`INSERT INTO terminos (libro, termino, termino_norm, traduccion, pagina, fuente, verificado) VALUES ${valores.slice(i, i + 50).join(",\n")};`);
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
