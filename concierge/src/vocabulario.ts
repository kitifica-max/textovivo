// Vocabulario por libro: puente entre lo que escribe quien consulta (en cualquier idioma, con sinónimos) y las
// palabras que de verdad están en el texto. Funciones puras: se prueban con npm test y las usan los dos buscadores.
//
// Cada fila: `termino` = como lo diría quien consulta (ES o EN, sinónimos) ↔ `traduccion` = palabra o frase COPIADA del texto
// del libro, en su idioma. La traducción tiene que aparecer literalmente en la página indicada (se valida antes de guardar).

/** Minúsculas, sin tildes y con espacios colapsados. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export type Termino = { termino: string; traduccion: string; pagina: number; fuente: string };

const PARADAS = new Set(
  ("como con del las los para pero por que sin sus una uno unos unas este esta esto son hay ser muy cual cuando donde mas sobre entre desde hasta " +
    "the and for with how what from into that this their about were was are has have its not but who which when where into over under " +
    "dice dicen cada todo toda todos todas ese esa eso aqui alli").split(" ")
);

/** Palabras con contenido de una consulta o un texto: normalizadas, de más de 2 letras y sin las vacías. */
export const palabras = (s: string) =>
  normalizar(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !PARADAS.has(w));

// Sufijos de mayor a menor. Truncado simple (no es un stemmer completo): quita un solo sufijo y deja una raíz de 4+ letras.
const SUFIJOS = [
  "amientos", "imientos", "amiento", "imiento", "aciones", "uciones", "acion", "ucion", "idades", "idad", "mente", "ables", "ibles",
  "ations", "ation", "ments", "ment", "ness", "ingly", "ings", "ing", "azgo", "ando", "iendo", "ados", "adas", "idos", "idas", "ado", "ada", "ido", "ida",
  "ores", "ador", "ismo", "ista", "anza", "able", "ible", "ies", "ied", "ers", "ing", "ed", "er", "es", "os", "as", "ly", "ar", "ir", "al", "s", "a", "o", "e", "y"
].sort((a, b) => b.length - a.length);

/** Raíz aproximada de una palabra (ya normalizada). «liderazgo» y «lider» → «lider»; «strategies» y «strategy» → «strateg». */
export function raiz(w: string) {
  for (const suf of SUFIJOS) if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
}

/** ¿Dos palabras comparten raíz? También cuando una es prefijo de la otra (5+ letras). */
export function mismaRaiz(a: string, b: string) {
  if (a === b) return true;
  const [x, y] = [raiz(a), raiz(b)];
  if (x === y) return true;
  const [c, l] = x.length <= y.length ? [x, y] : [y, x];
  return c.length >= 5 && l.startsWith(c);
}

const limpio = (s: string) => ` ${normalizar(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Posición (en el texto original) de la primera aparición de la frase, palabra por palabra y sin importar tildes,
 * mayúsculas ni puntuación. `prefijo`: la última palabra puede seguir (raíz). -1 si no aparece.
 */
export function posicionLiteral(texto: string, frase: string, prefijo = false) {
  const ws = sinTildes(frase).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!ws.length || ws.join("").length < 3) return -1;
  const patron = `(?<![\\p{L}\\p{N}])${ws.map(escapar).join("[^\\p{L}\\p{N}]+")}${prefijo ? "" : "(?![\\p{L}\\p{N}])"}`;
  return sinTildes(texto).search(new RegExp(patron, "u"));
}

export type Candidato = { termino: string; traduccion: string; pagina?: number; fuente: string };

/**
 * Deja solo los términos cuya traducción está literalmente en el texto del libro. La página se corrige si hacía falta
 * (el modelo puede equivocarse de página, no de palabras). Lo que no aparece se descarta.
 */
export function validarTerminos(candidatos: Candidato[], paginas: { pagina: number; texto: string }[]) {
  const vistos = new Set<string>();
  const buenos: Termino[] = [];
  const descartados: Candidato[] = [];
  for (const c of candidatos) {
    const termino = c.termino?.trim();
    const traduccion = c.traduccion?.trim();
    if (!termino || !traduccion || traduccion.length < 3 || termino.length < 2 || normalizar(termino) === normalizar(traduccion)) { descartados.push(c); continue; }
    const clave = `${normalizar(termino)}|${normalizar(traduccion)}`;
    if (vistos.has(clave)) continue;
    const indicada = paginas.find((p) => p.pagina === c.pagina);
    const donde = indicada && posicionLiteral(indicada.texto, traduccion) >= 0 ? indicada : paginas.find((p) => posicionLiteral(p.texto, traduccion) >= 0);
    if (!donde) { descartados.push(c); continue; }
    vistos.add(clave);
    buenos.push({ termino, traduccion, pagina: donde.pagina, fuente: c.fuente });
  }
  return { buenos, descartados };
}

/** Qué tanto se parece una palabra a otra por trigramas de letras (0 a 1): sirve para errores de tecleo. */
function trigramas(w: string) {
  const s = `  ${w} `;
  const r = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) r.add(s.slice(i, i + 3));
  return r;
}
const parecido = (a: string, b: string) => {
  const [x, y] = [trigramas(a), trigramas(b)];
  let n = 0;
  for (const t of x) if (y.has(t)) n++;
  return n / (x.size + y.size - n);
};

/** Puntaje de una fila contra una consulta: cuántas palabras de la consulta comparten raíz con el término (o es una frase contenida). */
function puntuar(consulta: string, q: string[], fila: Termino) {
  const frase = limpio(consulta);
  const tn = limpio(fila.termino);
  if (tn.trim().length >= 3 && frase.includes(tn)) return 4 * Math.max(1, palabras(fila.termino).length);
  const tw = palabras(fila.termino);
  if (!tw.length) return 0;
  const comunes = q.filter((w) => tw.some((t) => mismaRaiz(w, t))).length;
  if (!comunes) return 0;
  // Exige que la fila cubra buena parte de lo que se pidió o de lo que ella dice.
  const cobertura = comunes / Math.min(q.length, tw.length);
  return cobertura >= 0.5 ? comunes + cobertura : 0;
}

/** Filas del vocabulario que responden a la consulta, de mejor a peor (solo las que llegan a la mitad de la mejor). */
export function filasParaConsulta(consulta: string, terminos: Termino[], max = 8) {
  const q = [...new Set(palabras(consulta))];
  if (!q.length) return [];
  const p = terminos.map((fila) => ({ fila, p: puntuar(consulta, q, fila) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
  const mejor = p[0]?.p ?? 0;
  return p.filter((x) => x.p >= mejor * 0.5).slice(0, max).map((x) => x.fila);
}

/** Una etapa de búsqueda: términos a pedir juntos (and) o por separado (or). `prefijo` = coincide con cualquier palabra que empiece así. */
export type Pieza = { texto: string; prefijo?: boolean };
export type Etapa = {
  etiqueta: "completa" | "aproximada" | "expandida" | "parcial"; modo: "and" | "or"; piezas: Pieza[]; usados?: string[];
  /** Páginas que el vocabulario señala para esta consulta (p. ej. el inicio de un capítulo). Se favorecen en todas las etapas. */
  paginas?: number[];
  /** Si la etapa, además de favorecerlas, las agrega cuando la búsqueda por palabras no las encontró. */
  inyectar?: boolean;
};

/** Cuánto sube una página señalada por el vocabulario, y a qué fracción de la mejor entra si no la encontró la búsqueda. */
export const IMPULSO_DESIGNADA = 1.5;
export const ENTRADA_DESIGNADA = 0.9;

/** Aplica las páginas señaladas: sube las que ya salieron y, si la etapa lo pide, agrega las que faltaban. Devuelve todo ordenado. */
export function aplicarDesignadas<T extends { pagina: number; puntuacion: number }>(
  etapa: Etapa, encontrados: T[], traer: (paginas: number[], puntuacion: number) => T[], max: number
) {
  const dis = etapa.paginas ?? [];
  const mejor = Math.max(1, ...encontrados.map((r) => r.puntuacion));
  const subidos = encontrados.map((r) => (dis.includes(r.pagina) ? { ...r, puntuacion: r.puntuacion * IMPULSO_DESIGNADA } : r));
  const faltan = etapa.inyectar ? dis.filter((pg) => !subidos.some((r) => r.pagina === pg)).slice(0, Math.max(0, max - subidos.length)) : [];
  const traidas = faltan.length ? traer(faltan, mejor * ENTRADA_DESIGNADA) : [];
  return [...subidos, ...traidas].sort((a, b) => b.puntuacion - a.puntuacion).slice(0, max);
}

/**
 * Orden de intentos: 1) todas las palabras tal cual, 2) el vocabulario del libro (traducciones y sinónimos), 3) todas por raíz,
 * 4) respaldo: cualquiera de las anteriores. Cada etapa solo corre si la anterior no encontró nada.
 */
export function planDeBusqueda(consulta: string, terminos: Termino[] = []): Etapa[] {
  const q = [...new Set(palabras(consulta))].slice(0, 12);
  if (!q.length) return [];
  const exactas: Pieza[] = q.map((texto) => ({ texto }));
  const raices: Pieza[] = q.map((w) => (raiz(w).length >= 5 && raiz(w) !== w ? { texto: raiz(w), prefijo: true } : { texto: w }));
  const filas = filasParaConsulta(consulta, terminos);
  const frases = [...new Set(filas.map((f) => f.traduccion))];
  // Las sinónimas sueltas («jefe» → commander) no señalan página: solo las filas curadas (capítulo, framework, checklist, glosario del destilado).
  const paginas = [...new Set(filas.filter((f) => f.fuente !== "sinonimo").map((f) => f.pagina))];
  const etapas: Etapa[] = [{ etiqueta: "completa", modo: "and", piezas: exactas, paginas }];
  // El vocabulario curado va antes que las raíces: una raíz corta sin contexto puede coincidir por casualidad con otra palabra (otro idioma).
  if (frases.length) etapas.push({ etiqueta: "expandida", modo: "or", piezas: frases.map((texto) => ({ texto })), usados: frases, paginas, inyectar: true });
  if (raices.some((r) => r.prefijo)) etapas.push({ etiqueta: "aproximada", modo: "and", piezas: raices, paginas });

  const todas = new Map<string, Pieza>();
  const todasPiezas: Pieza[] = [...(raices.some((r) => r.prefijo) ? raices : exactas), ...frases.map((texto) => ({ texto }))];
  for (const p of todasPiezas) todas.set(`${p.texto}|${p.prefijo ? 1 : 0}`, p);
  if (q.length > 1 || frases.length) etapas.push({ etiqueta: "parcial", modo: "or", piezas: [...todas.values()], paginas, inyectar: true });
  return etapas;
}

/** Cadena MATCH de FTS5 para una etapa. Cada pieza entre comillas: FTS5 no interpreta operadores dentro. */
export const matchFts = (e: Etapa) =>
  e.piezas.map((p) => `"${p.texto.replaceAll('"', "")}"${p.prefijo ? "*" : ""}`).join(e.modo === "and" ? " " : " OR ");

/** Primera coincidencia de las piezas dentro de la página completa: qué pieza y en qué posición del texto. */
export function ubicarCoincidencia(texto: string, piezas: Pieza[]) {
  let mejor: { termino: string; posicion: number } | null = null;
  for (const p of piezas) {
    const i = posicionLiteral(texto, p.texto, p.prefijo);
    if (i >= 0 && (!mejor || i < mejor.posicion)) mejor = { termino: p.texto, posicion: i };
  }
  return mejor;
}

/**
 * Sugerencias para una consulta sin resultados: primero las traducciones del vocabulario que más se parecen a lo escrito
 * (por raíz o por trigramas); si nada se parece, el listado general del libro como último recurso.
 */
export function sugerenciasContextuales(consulta: string, terminos: Termino[], ultimoRecurso: string[], max = 8) {
  const q = [...new Set(palabras(consulta))];
  const puntuadas = terminos
    .map((t) => {
      const base = puntuar(consulta, q, t);
      const tw = [...palabras(t.termino), ...palabras(t.traduccion)];
      const tri = Math.max(0, ...q.flatMap((w) => tw.map((x) => parecido(w, x))));
      return { t, p: base > 0 ? base + 1 : tri >= 0.45 ? tri : 0 };
    })
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p);
  const vistas = new Set<string>();
  const lista = puntuadas.map((x) => x.t.traduccion).filter((s) => (vistas.has(s) ? false : (vistas.add(s), true))).slice(0, max);
  return { sugerencias: lista.length ? lista : ultimoRecurso.slice(0, max), contextuales: lista.length > 0 };
}

/** Fila del vocabulario derivado del destilado. `verificado: false` = el texto entre paréntesis no está literal en el libro: queda sin traducción. */
export type FilaTermino = Termino & { verificado: boolean };

type Destilable = {
  indice?: { titulo: string; pagina_inicio: number; pagina_fin: number }[];
  glosario: { termino: string; definicion: string; pagina: number }[];
  frameworks: { nombre: string; resumen: string; pasos: { pagina: number }[] }[];
  checklists: { nombre: string; contexto: string; items: { pagina: number }[] }[];
};

/** «Ley moral (Moral Law)» → nombre en español y traducción en inglés. Sin paréntesis final, no hay traducción. */
export function separarNombre(nombre: string) {
  const m = nombre.trim().match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m && m[1].trim() ? { es: m[1].trim(), en: m[2].trim() } : { es: nombre.trim(), en: "" };
}

/**
 * Vocabulario sacado SOLO de lo que ya trae el destilado (sin modelos): para cada glosario, framework, checklist y capítulo,
 * el nombre y la descripción en español como `termino`, y el texto entre paréntesis del nombre como `traduccion`.
 * La página es la de su cita (o el inicio del capítulo). La traducción se guarda solo si aparece literal en el libro.
 * Si el paréntesis completo no está literal, se usa su palabra más rara que sí lo esté (fuente `derivado-parcial`);
 * si ninguna lo está, queda vacía y marcada (verificado = false).
 */
export function derivarTerminos(d: Destilable, paginas: { pagina: number; texto: string }[]): FilaTermino[] {
  const elementos = [
    ...d.glosario.map((g) => ({ nombre: g.termino, descripcion: g.definicion, pagina: g.pagina, fuente: "glosario", hasta: g.pagina })),
    ...d.frameworks.map((f) => ({ nombre: f.nombre, descripcion: f.resumen, pagina: f.pasos[0]?.pagina ?? 1, fuente: "framework", hasta: f.pasos[0]?.pagina ?? 1 })),
    ...d.checklists.map((c) => ({ nombre: c.nombre, descripcion: c.contexto, pagina: c.items[0]?.pagina ?? 1, fuente: "checklist", hasta: c.items[0]?.pagina ?? 1 })),
    // Capítulos: solo los que traen traducción entre paréntesis («Capítulo III. Atacar con estratagemas (Attack By Stratagem)»).
    ...(d.indice ?? [])
      .filter((c) => separarNombre(c.titulo).en)
      .map((c) => ({ nombre: c.titulo.replace(/^cap[ií]tulo\s+[ivxlc\d]+\.?\s*/i, ""), descripcion: "", pagina: c.pagina_inicio, fuente: "capitulo", hasta: c.pagina_fin }))
  ];
  const df = (w: string) => paginas.filter((p) => posicionLiteral(p.texto, w) >= 0).length;
  const filas: FilaTermino[] = [];
  const vistos = new Set<string>();
  for (const e of elementos) {
    const { es, en } = separarNombre(e.nombre);
    let traduccion = "";
    let pagina = e.pagina;
    let fuente = e.fuente;
    // Primero la página de su cita (o del capítulo); si no, la primera donde aparezca.
    const dondeEsta = (t: string) => {
      const en_rango = paginas.filter((p) => p.pagina >= e.pagina && p.pagina <= Math.max(e.hasta, e.pagina) + 2);
      return en_rango.find((p) => posicionLiteral(p.texto, t) >= 0) ?? paginas.find((p) => posicionLiteral(p.texto, t) >= 0);
    };
    if (en.length >= 3) {
      const donde = dondeEsta(en);
      if (donde) { traduccion = en; pagina = donde.pagina; }
      else {
        // El paréntesis entero no está en el texto: se prueba con sus palabras sueltas y se elige la más rara que sí esté.
        const cand = [...new Set(palabras(en))].map((w) => ({ w, n: df(w) })).filter((x) => x.n > 0 && x.w.length >= 5).sort((a, b) => a.n - b.n || b.w.length - a.w.length)[0];
        const donde2 = cand && dondeEsta(cand.w);
        if (cand && donde2) { traduccion = cand.w; pagina = donde2.pagina; fuente = "derivado-parcial"; }
      }
    }
    for (const termino of [es, e.descripcion.trim().slice(0, 300)]) {
      const clave = `${normalizar(termino)}|${normalizar(traduccion)}`;
      if (!termino || vistos.has(clave)) continue;
      vistos.add(clave);
      filas.push({ termino, traduccion, pagina, fuente, verificado: traduccion !== "" });
    }
  }
  return filas;
}

/**
 * Vocabulario completo de un libro: lo derivado del destilado + lo escrito en data/libros/<id>/vocabulario.json (revisado por una persona).
 * Todo pasa por la misma regla: la traducción tiene que estar literal en el texto. `descartados` = filas manuales que ya no lo están.
 */
export function construirVocabulario(d: Destilable, paginas: { pagina: number; texto: string }[], manual: Candidato[] = []) {
  const derivados = derivarTerminos(d, paginas);
  const { buenos, descartados } = validarTerminos(manual, paginas);
  const vistos = new Set(derivados.filter((f) => f.verificado).map((f) => `${normalizar(f.termino)}|${normalizar(f.traduccion)}`));
  const propios: FilaTermino[] = buenos
    .filter((t) => !vistos.has(`${normalizar(t.termino)}|${normalizar(t.traduccion)}`))
    .map((t) => ({ ...t, verificado: true }));
  return { filas: [...derivados, ...propios], descartados };
}

/**
 * Fragmentos para pedirle a D1 solo las filas relacionadas con la consulta (LIKE '%fragmento%' sobre termino_norm):
 * cada palabra con contenido, y su raíz si es más corta (4+ letras) para que «lider» traiga «liderazgo».
 */
export function patronesDeConsulta(consulta: string) {
  const out = new Set<string>();
  for (const w of palabras(consulta).slice(0, 12)) {
    out.add(w);
    const r = raiz(w);
    if (r.length >= 4 && r !== w) out.add(r);
  }
  return [...out].map((x) => x.replace(/[%_\\]/g, ""));
}
