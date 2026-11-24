// Documentos personales: reglas de acceso y armado del libro que consume el conector (sin tocar la base: se puede probar solo).
export const PREFIJO_PERSONAL = "mi-";
export const MAX_DOCS = 10;
export const MAX_BYTES_DOC = 7 * 1024 * 1024;
export const MAX_BYTES_TOTAL = 40 * 1024 * 1024;
export const MAX_PAGINAS = 1500;

export const esIdPersonal = (id: string) => id.startsWith(PREFIJO_PERSONAL);

/** Planes que pueden usar documentos personales. «*» = todos (útil mientras no hay cobro). */
export function planHabilitado(plan: string, permitidos: string) {
  const lista = permitidos.split(",").map((x) => x.trim()).filter(Boolean);
  return lista.includes("*") || lista.includes(plan);
}

/** Un documento personal solo lo ve su dueño. */
export const puedeVer = (duenoId: string, usuarioId: string | null) => Boolean(usuarioId) && duenoId === usuarioId;

export type FilaPersonal = { id: string; titulo: string; idioma: string; paginacion: string; indice: string };
export function datosDestilado(f: FilaPersonal) {
  return {
    id: f.id, titulo: f.titulo, autor: "Documento personal", descripcion: "Documento subido por vos. Solo vos lo ves.",
    idioma: f.idioma, paginacion: f.paginacion, indice: JSON.parse(f.indice), glosario: [], frameworks: [], checklists: []
  };
}
