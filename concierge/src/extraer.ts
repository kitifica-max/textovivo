// Convierte un archivo subido (TXT, MD o PDF) en páginas e índice para la biblioteca.
import { extractText, getDocumentProxy } from "unpdf";

export type Pagina = { pagina: number; texto: string };
export type Seccion = { titulo: string; nivel: number; pagina_inicio: number; pagina_fin: number };
export type Extraido = { paginas: Pagina[]; indice: Seccion[]; paginacion: "logica" | "pdf" };

const MAX_PAGINA = 1500;

/** Secciones de 20 páginas: índice mínimo cuando el archivo no trae capítulos. */
function indiceEnBloques(n: number): Seccion[] {
  const out: Seccion[] = [];
  for (let a = 1; a <= n; a += 20) out.push({ titulo: `Páginas ${a}-${Math.min(a + 19, n)}`, nivel: 1, pagina_inicio: a, pagina_fin: Math.min(a + 19, n) });
  return out;
}

function texto(bytes: ArrayBuffer): Extraido {
  const crudo = new TextDecoder("utf-8").decode(bytes).replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const parrafos = crudo.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, " ").replace(/\n/g, " ").trim()).filter(Boolean);
  const paginas: Pagina[] = [];
  const titulos: { titulo: string; pagina: number }[] = [];
  let actual = "";
  const cerrar = () => {
    if (actual) paginas.push({ pagina: paginas.length + 1, texto: actual.trim() });
    actual = "";
  };
  for (const p of parrafos) {
    const h = p.match(/^#{1,3}\s+(.{1,120})$/); // encabezado de Markdown: abre página nueva
    if (h) {
      if (actual.length >= 120) cerrar();
      titulos.push({ titulo: h[1], pagina: paginas.length + 1 });
    }
    const trozos = p.length > MAX_PAGINA ? (p.match(/[^.!?…]+[.!?…]+["”')\]]*\s*|[^.!?…]+$/g) ?? [p]) : [p];
    for (const t of trozos) {
      if (actual.length >= 120 && actual.length + t.length + 1 > MAX_PAGINA) cerrar();
      actual += (actual ? "\n\n" : "") + t.trim();
    }
  }
  cerrar();
  if (!titulos.length) return { paginas, indice: indiceEnBloques(paginas.length), paginacion: "logica" };
  const indice: Seccion[] = titulos.map((t, i) => ({
    titulo: t.titulo,
    nivel: 1,
    pagina_inicio: t.pagina,
    pagina_fin: Math.max(t.pagina, (titulos[i + 1]?.pagina ?? paginas.length + 1) - 1)
  }));
  if (indice[0].pagina_inicio > 1) indice.unshift({ titulo: "Preliminares", nivel: 1, pagina_inicio: 1, pagina_fin: indice[0].pagina_inicio - 1 });
  return { paginas, indice, paginacion: "logica" };
}

async function pdf(bytes: ArrayBuffer): Promise<Extraido> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(doc, { mergePages: false });
  const paginas = text.map((t, i) => ({ pagina: i + 1, texto: t.replace(/\s+/g, " ").trim() || "(página sin texto)" }));
  return { paginas, indice: indiceEnBloques(paginas.length), paginacion: "pdf" };
}

export async function extraer(nombre: string, bytes: ArrayBuffer): Promise<Extraido> {
  const r = /\.pdf$/i.test(nombre) ? await pdf(bytes) : texto(bytes);
  const util = r.paginas.filter((p) => p.texto.length >= 40).length;
  const total = r.paginas.reduce((n, p) => n + p.texto.length, 0);
  if (!r.paginas.length || total < 500 || util / r.paginas.length < 0.5)
    throw new Error("El archivo casi no tiene texto extraíble (¿es un PDF escaneado como imagen?). Hace falta una versión con texto.");
  return r;
}
