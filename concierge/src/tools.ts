// Lógica de las herramientas MCP sobre un solo libro en memoria.
// Funciones puras: no saben nada de MCP, D1 ni Workers (se prueban con npm test).
import type { Destilado, Paginas } from "./schema.ts";

import {
  aplicarDesignadas, filasParaConsulta, matchFts, normalizar, palabras, planDeBusqueda, posicionLiteral, sugerenciasContextuales, ubicarCoincidencia,
  type Etapa, type Pieza, type Termino
} from "./vocabulario.ts";
export { normalizar, type Termino };

const MAX_CARACTERES = 7000; // ≈ 2.000 tokens por respuesta (regla de la spec)
const MAX_PASAJE = 1500;
const MAX_CITA = 300;

/**
 * completa: la página tiene todas las palabras de la consulta. aproximada: las tiene por raíz (plurales, derivadas).
 * expandida: se tradujo la consulta con el vocabulario del libro. parcial: solo algunas (respaldo).
 */
export type Coincidencia = "completa" | "aproximada" | "expandida" | "parcial";
export type Resultado = {
  pagina: number; texto: string; puntuacion: number; coincidencia?: Coincidencia;
  /** Lo que se buscó de verdad en esta etapa (palabras, raíces o traducciones): sirve para decir dónde coincidió. */
  piezas?: Pieza[]; usados?: string[];
};
/** Una página entra si llega al 50 % de la puntuación de la mejor: lo demás es ruido. */
export const UMBRAL_RELEVANCIA = 0.5;
export const filtrarPorUmbral = <T extends { puntuacion: number }>(rs: T[]) => {
  const mejor = Math.max(0, ...rs.map((r) => r.puntuacion));
  return rs.filter((r) => r.puntuacion >= mejor * UMBRAL_RELEVANCIA);
};
/** Devuelve las páginas que mejor responden a la consulta, de más a menos relevante. */
export type Buscador = (consulta: string, max: number) => Promise<Resultado[]>;
export type Libro = ReturnType<typeof crearLibro>;

/** cargarTerminos: vocabulario del libro (D1 en producción, una lista fija en pruebas). Sin él, solo se busca por las palabras escritas. */
export function crearLibro(d: Destilado, buscar: Buscador, cargarTerminos: () => Promise<Termino[]> = async () => []) {
  const seccion = (pagina: number) =>
    d.indice
      .filter((s) => s.pagina_inicio <= pagina && pagina <= s.pagina_fin)
      .sort((a, b) => b.nivel - a.nivel)[0]?.titulo ?? "";
  return { ...d, seccion, buscar, cargarTerminos };
}

/** Cuántas veces aparece la pieza en el texto (frase entera, o palabra que empieza así si es raíz). */
function contar(texto: string, p: Pieza) {
  let n = 0;
  let desde = 0;
  const t = texto.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  for (;;) {
    const i = posicionLiteral(t.slice(desde), p.texto, p.prefijo);
    if (i < 0) return n;
    n++;
    desde += i + Math.max(1, p.texto.length);
  }
}

/** Buscador en memoria (TF-IDF por página): para tests y desarrollo sin D1. Mismo plan de etapas que el de D1. */
export function buscadorMemoria(paginas: Paginas, terminos: Termino[] = []): Buscador {
  const df = new Map<string, number>();
  const idf = (p: Pieza) => {
    const k = `${p.texto}|${p.prefijo ? 1 : 0}`;
    if (!df.has(k)) df.set(k, paginas.filter((d) => contar(d.texto, p) > 0).length);
    return Math.log(1 + paginas.length / (df.get(k) || 1));
  };

  return async (consulta, max) => {
    const q = [...new Set(palabras(consulta))];
    const pares = q.slice(1).map((w, i) => `${q[i]} ${w}`);
    for (const etapa of planDeBusqueda(consulta, terminos)) {
      const puntuados = paginas
        .map((doc) => {
          const n = etapa.piezas.map((p) => contar(doc.texto, p));
          const cumple = etapa.modo === "and" ? n.every((x) => x > 0) : n.some((x) => x > 0);
          if (!cumple) return null;
          const tfidf = etapa.piezas.reduce((s, p, i) => (n[i] ? s + (1 + Math.log(n[i])) * idf(p) : s), 0);
          // Premia la frase exacta y los pares de palabras seguidas.
          const bonus = (consulta.trim().length > 6 && posicionLiteral(doc.texto, consulta) >= 0 ? 5 : 0) + pares.filter((par) => posicionLiteral(doc.texto, par) >= 0).length * 2;
          return { pagina: doc.pagina, texto: doc.texto, puntuacion: tfidf + bonus };
        })
        .filter((r): r is { pagina: number; texto: string; puntuacion: number } => r !== null && r.puntuacion > 0);
      const elegidos = aplicarDesignadas(
        etapa,
        filtrarPorUmbral(puntuados),
        (pgs, p) => paginas.filter((d) => pgs.includes(d.pagina)).map((d) => ({ pagina: d.pagina, texto: d.texto, puntuacion: p })),
        max
      );
      if (!elegidos.length) continue;
      return elegidos.map((r) => ({ ...r, coincidencia: etapa.etiqueta, piezas: etapa.piezas, usados: etapa.usados }));
    }
    return [];
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

/** Palabras enteras: «guerra» no activa «guerrilla» ni una consulta corta activa cualquier término que la contenga. */
const enteras = (s: string) => normalizar(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function terminoDelGlosario(l: Libro, consulta: string) {
  const q = enteras(consulta);
  const qs = ` ${q.join(" ")} `;
  return l.glosario.find((g) => {
    const t = enteras(g.termino);
    return qs.includes(` ${t.join(" ")} `) || (q.join("").length >= 4 && q.every((w) => t.includes(w)));
  });
}

/** Cuando la consulta no entra en el libro: términos reales del libro, en su idioma, para reintentar. */
function sugerenciasDelLibro(l: Libro) {
  return [
    ...l.glosario.map((g) => g.termino),
    ...l.frameworks.map((f) => f.nombre),
    ...l.checklists.map((c) => c.nombre),
    ...l.indice.map((s) => s.titulo)
  ]
    .filter((x, i, arr) => x && arr.indexOf(x) === i)
    .slice(0, 8);
}

export async function buscarConcepto(l: Libro, consulta: string, max = 5) {
  const termino = terminoDelGlosario(l, consulta);

  const resultados = [];
  let coincidencia: Coincidencia | undefined;
  let usados: string[] | undefined;
  let usadosChars = 0;
  for (const { pagina, texto: pag, puntuacion, coincidencia: c, piezas, usados: u } of await l.buscar(consulta, Math.min(max, 10))) {
    const texto = pag.slice(0, Math.min(MAX_PASAJE, MAX_CARACTERES - usadosChars));
    if (!texto) break;
    usadosChars += texto.length;
    coincidencia ??= c;
    usados ??= u;
    // Dónde coincidió: si el término que hizo entrar a la página queda fuera del fragmento recortado, se dice.
    const ubicada = piezas ? ubicarCoincidencia(pag, piezas) : null;
    resultados.push({
      texto,
      seccion: l.seccion(pagina),
      pagina_inicio: pagina,
      pagina_fin: pagina,
      puntuacion: Math.round(puntuacion * 100) / 100,
      ...(ubicada && { coincide_en: { termino: ubicada.termino, posicion: ubicada.posicion, en_fragmento: ubicada.posicion < texto.length } })
    });
  }

  if (!termino && resultados.length === 0) {
    const idioma = l.idioma === "es" ? "español" : l.idioma === "en" ? "inglés" : `su idioma original (${l.idioma})`;
    const { sugerencias, contextuales } = sugerenciasContextuales(consulta, await l.cargarTerminos(), sugerenciasDelLibro(l));
    return {
      mensaje: contextuales
        ? `No encontré nada sobre «${consulta}» en este libro (el texto está en ${idioma}). Lo más parecido que sí trae el libro:`
        : `No encontré nada sobre «${consulta}» en este libro. El texto está en ${idioma}: probá con palabras de esa lengua o con alguno de estos términos del libro.`,
      sugerencias
    };
  }
  return {
    ...(termino && {
      glosario: {
        termino: termino.termino,
        definicion: termino.definicion,
        pagina: termino.pagina,
        cita: termino.cita
      }
    }),
    ...(coincidencia && { coincidencia }),
    ...(coincidencia === "parcial" && { nota: "Ninguna página contiene todas las palabras de la consulta: estos resultados coinciden solo en parte." }),
    ...(coincidencia === "expandida" && usados?.length && { nota: `Tu consulta se tradujo con el vocabulario del libro: se buscó ${usados.slice(0, 6).map((x) => `«${x}»`).join(", ")}.` }),
    ...(resultados.some((r) => r.coincide_en && !r.coincide_en.en_fragmento) && { aviso_fragmento: "En algunos resultados la coincidencia queda más allá del fragmento mostrado: mirá coincide_en.posicion." }),
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

  // Sin coincidencias no se devuelve nada: ocultar el desajuste con «el único que hay» engaña al lector.
  if (puntuados.length === 0) return { item: undefined, candidatos: [] };
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
  const paginas = await l.buscar(afirmacion, 3);
  if (!paginas.length) return { mensaje: `No encontré en el texto nada que respalde «${afirmacion}».` };

  const qp = new Set(palabras(afirmacion));
  const candidatas = paginas
    .flatMap((pg) =>
      pg.texto.split(/(?<=[.!?…])\s+/).map((o) => ({ o, pagina: pg.pagina, p: palabras(o).filter((w) => qp.has(w)).length }))
    )
    .filter((c) => c.p > 0)
    .sort((a, b) => b.p - a.p);
  if (!candidatas.length) return { mensaje: `No encontré en el texto nada que respalde «${afirmacion}».` };

  const recortar = (o: string) => (o.length > MAX_CITA ? `${o.slice(0, MAX_CITA - 1)}…` : o);
  const mejor = candidatas[0];
  // Si otra oración queda casi igual de buena, se ofrece: el lector decide cuál respalda mejor su afirmación.
  const parecidas = candidatas.slice(1, 3).filter((c) => c.p >= 0.8 * mejor.p && c.o !== mejor.o);
  return {
    cita_literal: recortar(mejor.o),
    capitulo: l.seccion(mejor.pagina),
    pagina: mejor.pagina,
    ...(parecidas.length && {
      otras_candidatas: parecidas.map((c) => ({ cita_literal: recortar(c.o), capitulo: l.seccion(c.pagina), pagina: c.pagina }))
    })
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

/** ¿La herramienta no encontró nada? (la respuesta es solo un mensaje de «No encontré…» / «No hay…», sin resultados ni glosario). */
export function esSinResultado(r: unknown) {
  const o = r as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.mensaje !== "string") return false;
  if (["resultados", "glosario", "pasos", "items", "cita_literal", "capitulos"].some((k) => k in o && (!Array.isArray(o[k]) || (o[k] as unknown[]).length))) return false;
  return /^No (encontré|hay)(\s|$)/.test(o.mensaje);
}
