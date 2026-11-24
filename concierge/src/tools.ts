// Lógica de las herramientas MCP sobre un solo libro en memoria.
// Funciones puras: no saben nada de MCP, D1 ni Workers (se prueban con npm test).
import type { Destilado, Paginas } from "./schema.ts";

const VACIAS = new Set(
  "como con del las los para pero por que sin sus una uno este esta esto son hay ser muy cual cuando donde mas the and for with how what".split(" ")
);

/** Minúsculas, sin tildes y con espacios colapsados. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const palabras = (s: string) =>
  normalizar(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !VACIAS.has(w));

const MAX_CARACTERES = 7000; // ≈ 2.000 tokens por respuesta (regla de la spec)
const MAX_PASAJE = 1500;
const MAX_CITA = 300;

export type Resultado = { pagina: number; texto: string; puntuacion: number };
/** Devuelve las páginas que mejor responden a la consulta, de más a menos relevante. */
export type Buscador = (consulta: string, max: number) => Promise<Resultado[]>;
export type Libro = ReturnType<typeof crearLibro>;

export function crearLibro(d: Destilado, buscar: Buscador) {
  const seccion = (pagina: number) =>
    d.indice
      .filter((s) => s.pagina_inicio <= pagina && pagina <= s.pagina_fin)
      .sort((a, b) => b.nivel - a.nivel)[0]?.titulo ?? "";
  return { ...d, seccion, buscar };
}

/** Buscador en memoria (TF-IDF por página): para tests y desarrollo sin D1. */
export function buscadorMemoria(paginas: Paginas): Buscador {
  const docs = paginas.map((p) => {
    const tf = new Map<string, number>();
    for (const w of palabras(p.texto)) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { ...p, tf, plano: normalizar(p.texto) };
  });
  const df = new Map<string, number>();
  for (const doc of docs) for (const w of doc.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(1 + docs.length / (df.get(w) ?? 1));

  return async (consulta, max) => {
    const frase = normalizar(consulta);
    const q = palabras(consulta);
    const unicas = [...new Set(q)];
    const pares = q.slice(1).map((w, i) => `${q[i]} ${w}`);
    return docs
      .map((doc) => {
        const tfidf = unicas.reduce((s, w) => {
          const n = doc.tf.get(w) ?? 0;
          return n ? s + (1 + Math.log(n)) * idf(w) : s;
        }, 0);
        // Premia la frase exacta y los pares de palabras seguidas.
        const bonus =
          (frase.length > 6 && doc.plano.includes(frase) ? 5 : 0) +
          pares.filter((par) => doc.plano.includes(par)).length * 2;
        return { pagina: doc.pagina, texto: doc.texto, puntuacion: tfidf ? tfidf + bonus : 0 };
      })
      .filter((r) => r.puntuacion > 0)
      .sort((a, b) => b.puntuacion - a.puntuacion)
      .slice(0, max);
  };
}

/** Qué significa «página» en las citas de este libro (el lector debe saberlo antes de buscarla). */
export const notaPaginas = (l: Pick<Libro, "paginacion">) =>
  l.paginacion === "aforismo"
    ? "Las páginas son los números de aforismo de la obra."
    : l.paginacion === "pdf"
    ? "Las páginas son las del archivo PDF que subió el autor; pueden diferir de la numeración impresa."
    : "Las páginas son secciones lógicas del texto digital (~1.500 caracteres), no las páginas de una edición impresa: usá el capítulo y la cita literal para ubicar el pasaje en tu ejemplar.";

export function listarIndice(l: Libro) {
  return {
    titulo: l.titulo,
    paginacion: notaPaginas(l),
    autor: l.autor,
    descripcion: l.descripcion,
    capitulos: l.indice.map((s) => ({
      titulo: s.titulo,
      nivel: s.nivel,
      paginas: `${s.pagina_inicio}-${s.pagina_fin}`
    })),
    frameworks: l.frameworks.map((f) => f.nombre),
    checklists: l.checklists.map((c) => c.nombre),
    glosario: l.glosario.map((g) => g.termino)
  };
}

export async function buscarConcepto(l: Libro, consulta: string, max = 5) {
  const q = normalizar(consulta);
  const termino = l.glosario.find((g) => {
    const t = normalizar(g.termino);
    return q.includes(t) || (q.length >= 4 && t.includes(q));
  });

  const resultados = [];
  let usados = 0;
  for (const { pagina, texto: pag, puntuacion } of await l.buscar(consulta, Math.min(max, 10))) {
    const texto = pag.slice(0, Math.min(MAX_PASAJE, MAX_CARACTERES - usados));
    if (!texto) break;
    usados += texto.length;
    resultados.push({
      texto,
      seccion: l.seccion(pagina),
      pagina_inicio: pagina,
      pagina_fin: pagina,
      puntuacion: Math.round(puntuacion * 100) / 100
    });
  }

  if (!termino && resultados.length === 0)
    return { mensaje: `No encontré nada sobre «${consulta}» en este libro.` };
  return {
    ...(termino && {
      glosario: {
        termino: termino.termino,
        definicion: termino.definicion,
        pagina: termino.pagina,
        cita: termino.cita
      }
    }),
    resultados
  };
}

/** Busca por nombre exacto y, si no, por palabras. Si hay empate, devuelve candidatos. */
function elegir<T extends { nombre: string }>(items: T[], consulta: string, textoDe: (x: T) => string) {
  const q = normalizar(consulta);
  const exacto = items.find((x) => normalizar(x.nombre) === q);
  if (exacto) return { item: exacto, candidatos: [] };

  const qp = new Set(palabras(consulta));
  const puntuados = items
    .map((x) => ({
      x,
      p: palabras(`${x.nombre} ${x.nombre} ${textoDe(x)}`).filter((w) => qp.has(w)).length
    }))
    .filter((r) => r.p > 0)
    .sort((a, b) => b.p - a.p);

  // Si el libro tiene uno solo, es ese: la consulta puede estar en otro idioma o con otras palabras.
  if (puntuados.length === 0) return { item: items.length === 1 ? items[0] : undefined, candidatos: [] };
  if (puntuados.length === 1 || puntuados[0].p >= 1.5 * puntuados[1].p)
    return { item: puntuados[0].x, candidatos: [] };
  return { item: undefined, candidatos: puntuados.slice(0, 5).map((r) => r.x.nombre) };
}

const sinResultado = (tipo: string, tema: string, candidatos: string[], disponibles: string[]) =>
  candidatos.length
    ? { mensaje: `Hay varios ${tipo} posibles. Pedí uno por su nombre.`, candidatos }
    : {
        mensaje: `No hay ${tipo} sobre «${tema}». Disponibles: ${disponibles.join(", ") || "ninguno"}.`
      };

export function obtenerFramework(l: Libro, tema: string) {
  const { item: f, candidatos } = elegir(
    l.frameworks,
    tema,
    (f) => `${f.resumen} ${f.pasos.map((p) => `${p.titulo} ${p.descripcion} ${p.cita}`).join(" ")}`
  );
  if (!f) return sinResultado("frameworks", tema, candidatos, l.frameworks.map((x) => x.nombre));
  return {
    nombre: f.nombre,
    resumen: f.resumen,
    pasos: f.pasos.map(({ orden, titulo, descripcion, pagina, cita }) => ({
      orden,
      titulo,
      descripcion,
      pagina,
      cita
    })),
    verificado: f.verificado
  };
}

export function obtenerChecklist(l: Libro, tema: string) {
  const { item: c, candidatos } = elegir(
    l.checklists,
    tema,
    (c) => `${c.contexto} ${c.items.map((i) => `${i.texto} ${i.cita}`).join(" ")}`
  );
  if (!c) return sinResultado("checklists", tema, candidatos, l.checklists.map((x) => x.nombre));
  return {
    nombre: c.nombre,
    contexto: c.contexto,
    items: c.items.map(({ texto, pagina, cita }) => ({ texto, pagina, cita })),
    verificado: c.verificado
  };
}

/** La cita sale del texto guardado, nunca de un LLM. */
export async function citarFuente(l: Libro, afirmacion: string) {
  const mejor = (await l.buscar(afirmacion, 1))[0];
  if (!mejor) return { mensaje: `No encontré en el texto nada que respalde «${afirmacion}».` };

  const qp = new Set(palabras(afirmacion));
  const oracion = mejor.texto
    .split(/(?<=[.!?…])\s+/)
    .map((o) => ({ o, p: palabras(o).filter((w) => qp.has(w)).length }))
    .sort((a, b) => b.p - a.p)[0].o;

  return {
    cita_literal: oracion.length > MAX_CITA ? `${oracion.slice(0, MAX_CITA - 1)}…` : oracion,
    capitulo: l.seccion(mejor.pagina),
    pagina: mejor.pagina
  };
}

/** Todas las citas del destilado que NO aparecen en su página. Debe quedar vacío. */
export function citasInvalidas(d: Destilado, paginas: Paginas) {
  const texto = new Map(paginas.map((p) => [p.pagina, normalizar(p.texto)]));
  const citas: [number, string][] = [
    ...d.glosario.map((g): [number, string] => [g.pagina, g.cita]),
    ...d.frameworks.flatMap((f) => f.pasos.map((s): [number, string] => [s.pagina, s.cita])),
    ...d.checklists.flatMap((c) => c.items.map((i): [number, string] => [i.pagina, i.cita]))
  ];
  return citas
    .filter(([pagina, cita]) => !texto.get(pagina)?.includes(normalizar(cita)))
    .map(([pagina, cita]) => `p. ${pagina}: "${cita}"`);
}
