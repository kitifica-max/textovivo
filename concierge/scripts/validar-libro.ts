// Compuertas de calidad de un libro. Se corren al final de preparar-libro.ts y de nuevo en catalogo.ts:
// un libro con algún control en ERROR no se publica. Deja el registro en data/libros/<id>/control.json.
//
// Qué significa «página» (decisión de producto, ver README):
//   - lógica (por defecto): secciones de ~1.500 caracteres del texto digital. NO es la página del libro impreso.
//   - aforismo: la página es el número del aforismo (Gracián), que sí es el del libro.
// Cada libro lo declara en meta.json → "paginacion".
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Destilado, Paginas } from "../src/schema.ts";
import { buscadorMemoria, citasInvalidas, normalizar } from "../src/tools.ts";

export type Control = { ok: boolean; nivel: "error" | "aviso" | "info"; detalle: string };
export type Registro = {
  libro: string;
  fecha: string;
  fuente: string | null;
  fuente_sha256: string | null;
  paginacion: string;
  paginas: number;
  capitulos: number;
  aprobado: boolean;
  controles: Record<string, Control>;
};

const leer = async (ruta: string) => JSON.parse(await readFile(ruta, "utf8"));
const palabras = (s: string) => normalizar(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export async function validar(id: string, destilado?: Destilado): Promise<Registro> {
  const dir = `data/libros/${id}`;
  const paginas = Paginas.parse(await leer(`${dir}/paginas.json`));
  const meta = await leer(`${dir}/meta.json`).catch(() => ({}));
  const indice: { titulo: string; pagina_inicio: number; pagina_fin: number }[] =
    destilado?.indice ?? (await leer(`${dir}/indice.json`));
  const c: Record<string, Control> = {};
  const N = paginas.length;

  // 1. Páginas: numeradas 1..N sin saltos y ninguna vacía o diminuta (salvo la última).
  const saltos = paginas.filter((p, i) => p.pagina !== i + 1).length;
  const vacias = paginas.filter((p) => p.texto.trim().length < 40);
  c.paginas = {
    ok: saltos === 0 && vacias.length === 0 && N > 0,
    nivel: "error",
    detalle: `${N} páginas; ${saltos} saltos de numeración; ${vacias.length} vacías o de menos de 40 caracteres${vacias.length ? ` (p. ${vacias.slice(0, 5).map((p) => p.pagina).join(", ")})` : ""}`
  };
  // Una página corta en medio de un capítulo es sospechosa; la última de cada capítulo es el resto natural.
  const finales = new Set(indice.map((s) => s.pagina_fin));
  const cortas = paginas.filter((p) => p.texto.length < 200 && p.texto.length >= 40 && !finales.has(p.pagina) && meta.paginacion !== "aforismo");
  c.paginas_cortas = { ok: cortas.length === 0, nivel: "aviso", detalle: cortas.length ? `${cortas.length} páginas de menos de 200 caracteres a mitad de capítulo (p. ${cortas.slice(0, 5).map((p) => p.pagina).join(", ")})` : "sin páginas cortas a mitad de capítulo" };

  // 2. Índice: cubre el libro de la página 1 a la N, sin huecos ni solapes.
  const huecos: string[] = [];
  indice.forEach((s, i) => {
    const prev = indice[i - 1];
    if (i === 0 && s.pagina_inicio !== 1) huecos.push(`empieza en p. ${s.pagina_inicio}`);
    if (prev && s.pagina_inicio !== prev.pagina_fin + 1) huecos.push(`«${s.titulo.slice(0, 25)}» empieza en p. ${s.pagina_inicio} y el anterior termina en p. ${prev.pagina_fin}`);
    if (s.pagina_fin < s.pagina_inicio) huecos.push(`«${s.titulo.slice(0, 25)}» termina antes de empezar`);
  });
  if (indice.at(-1) && indice.at(-1)!.pagina_fin !== N) huecos.push(`termina en p. ${indice.at(-1)!.pagina_fin} de ${N}`);
  c.indice_cobertura = { ok: huecos.length === 0 && indice.length > 0, nivel: "error", detalle: huecos.length ? huecos.slice(0, 3).join("; ") : `${indice.length} secciones cubren las ${N} páginas` };

  // 3. Avisos de configuración sospechosa (no bloquean, pero hay que mirarlos).
  const sospechas: string[] = [];
  if (indice.length === 1 && N > 80) sospechas.push(`un solo capítulo en un libro de ${N} páginas (¿falló el patrón?)`);
  const unaPagina = indice.filter((s) => s.pagina_fin === s.pagina_inicio && N > 30);
  if (unaPagina.length) sospechas.push(`${unaPagina.length} capítulos de una sola página (¿títulos del índice o encabezados de página?)`);
  const enorme = indice.find((s) => indice.length > 1 && s.pagina_fin - s.pagina_inicio + 1 > N * 0.5);
  if (enorme) sospechas.push(`«${enorme.titulo.slice(0, 30)}» ocupa más de la mitad del libro`);
  const repetidos = indice.length - new Set(indice.map((s) => s.titulo)).size;
  if (repetidos) sospechas.push(`${repetidos} títulos repetidos`);
  c.configuracion = { ok: sospechas.length === 0, nivel: "aviso", detalle: sospechas.join("; ") || "sin sospechas" };

  // 4. Fidelidad: cuánto del texto de la fuente llegó a las páginas (se descartan cabecera, pie, índice y notas).
  let fuente: string | null = null;
  let sha: string | null = null;
  try {
    const crudo = await readFile(`fuentes/${id}/fuente.txt`);
    fuente = `fuentes/${id}/fuente.txt`;
    sha = createHash("sha256").update(crudo).digest("hex");
    let t = crudo.toString("utf8");
    t = t.split(/^\*\*\* START OF .*$/m)[1]?.split(/^\*\*\* END OF .*$/m)[0] ?? t;
    const enFuente = palabras(t).length;
    const enPaginas = paginas.reduce((n, p) => n + palabras(p.texto).length, 0);
    const razon = enPaginas / enFuente;
    c.fidelidad = {
      ok: razon >= 0.8 && razon <= 1.02,
      nivel: "error",
      detalle: `${(razon * 100).toFixed(1)} % de las palabras de la fuente están en las páginas (mínimo 80 %)`
    };
  } catch {
    c.fidelidad = { ok: true, nivel: "info", detalle: "sin fuente.txt (texto armado desde otra fuente): no se compara" };
  }

  // 5. Búsqueda: 12 oraciones tomadas del libro, buscadas tal cual, deben devolver su página entre las 3 primeras.
  const buscar = buscadorMemoria(paginas);
  const pruebas: { pagina: number; oracion: string }[] = [];
  for (let k = 0; k < 12 && N > 0; k++) {
    const p = paginas[Math.floor(((k + 0.5) * N) / 12)];
    const oracion = p.texto.split(/(?<=[.!?…])\s+/).find((o) => o.length >= 60 && o.length <= 220);
    if (oracion) pruebas.push({ pagina: p.pagina, oracion });
  }
  let aciertos = 0;
  for (const { pagina, oracion } of pruebas) {
    const r = await buscar(oracion, 3);
    if (r.some((x) => x.pagina === pagina)) aciertos++;
  }
  c.busqueda = {
    ok: pruebas.length === 0 || aciertos / pruebas.length >= 0.8,
    nivel: "error",
    detalle: `${aciertos} de ${pruebas.length} oraciones del libro se encuentran en las 3 primeras respuestas (mínimo 80 %)`
  };

  // 6. Citas del destilado: todas existen tal cual en su página.
  if (destilado) {
    const malas = citasInvalidas(destilado, paginas);
    const total = destilado.glosario.length + destilado.frameworks.reduce((n, f) => n + f.pasos.length, 0) + destilado.checklists.reduce((n, l) => n + l.items.length, 0);
    c.citas = { ok: malas.length === 0, nivel: "error", detalle: `${total - malas.length} de ${total} citas existen literalmente en su página${malas.length ? `; fallan: ${malas.slice(0, 2).join(" | ")}` : ""}` };
  }

  const registro: Registro = {
    libro: id,
    fecha: new Date().toISOString().slice(0, 10),
    fuente,
    fuente_sha256: sha,
    paginacion: meta.paginacion ?? "logica",
    paginas: N,
    capitulos: indice.length,
    aprobado: Object.values(c).every((x) => x.ok || x.nivel !== "error"),
    controles: c
  };
  await writeFile(`${dir}/control.json`, JSON.stringify(registro, null, 1) + "\n");
  return registro;
}

export const resumen = (r: Registro) =>
  [`${r.aprobado ? "✓" : "✗"} ${r.libro} (${r.paginas} páginas, ${r.capitulos} secciones, paginación ${r.paginacion})`]
    .concat(Object.entries(r.controles).filter(([, x]) => !x.ok).map(([k, x]) => `    ${x.nivel === "error" ? "ERROR" : "aviso"} ${k}: ${x.detalle}`))
    .join("\n");

if (process.argv[1]?.endsWith("validar-libro.ts")) {
  const r = await validar(process.argv[2]);
  console.log(resumen(r));
  process.exit(r.aprobado ? 0 : 1);
}
