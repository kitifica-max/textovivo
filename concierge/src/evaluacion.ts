// Evalúa un envío (reglas + duplicados + IA) y, si corresponde, lo publica. Comparte la publicación con la aprobación manual.
import { env } from "cloudflare:workers";
import { extraer, type Extraido } from "./extraer.ts";
import { analizarReglas, decidir, evaluarConIA, huella, muestras, tramosParaCotejo, type Hallazgo } from "./moderacion.ts";

export const slug = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "obra";

export type EnvioFila = {
  id: string; user_id: string; titulo: string; autor_nombre: string; tipo: string; idioma: string; descripcion: string;
  archivo_key: string; archivo_nombre: string; estado: string; libro_id: string | null;
};

const ahora = () => new Date().toISOString();
const MODELO_CLASIFICAR = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODELO_SEGURIDAD = "@cf/meta/llama-guard-3-8b";

/** Publica un envío: indexa su texto, crea el libro y marca quién lo aprobó. Devuelve el id del libro. */
export async function publicarEnvio(e: EnvioFila, r: Extraido, por: "auto" | "manual") {
  const libroId = `u-${slug(e.titulo)}-${e.id.slice(0, 6)}`;
  await env.DB.prepare("DELETE FROM paginas_fts WHERE libro = ?").bind(libroId).run();
  for (let i = 0; i < r.paginas.length; i += 50)
    await env.DB.batch(r.paginas.slice(i, i + 50).map((p) => env.DB.prepare("INSERT INTO paginas_fts (texto, libro, pagina) VALUES (?, ?, ?)").bind(p.texto, libroId, p.pagina)));
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR REPLACE INTO libros_dyn (id, envio_id, titulo, autor, tipo, idioma, descripcion, paginacion, indice, paginas, publicado_at, visible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(libroId, e.id, e.titulo, e.autor_nombre, e.tipo, e.idioma, e.descripcion, r.paginacion, JSON.stringify(r.indice), r.paginas.length, t),
    env.DB.prepare("UPDATE envios SET estado = 'aprobado', revisado_at = ?, libro_id = ?, nota = NULL, aprobado_por = ? WHERE id = ?").bind(t, libroId, por, e.id)
  ]);
  return libroId;
}

async function guardar(id: string, h: Hallazgo[], hash: string | null) {
  const d = decidir(h);
  await env.DB.prepare("UPDATE envios SET veredicto = ?, puntaje = ?, motivos = ?, evaluado_at = ?, texto_hash = COALESCE(?, texto_hash) WHERE id = ?")
    .bind(d.veredicto, d.puntaje, JSON.stringify(h), ahora(), hash, id).run();
  return d;
}

/**
 * Modo (APROBACION_AUTO): «off» no evalúa, «sombra» evalúa y deja el veredicto pero siempre pide revisión manual,
 * «on» publica solo lo que pasa todo. Ante cualquier duda (o si la IA no responde), revisión manual.
 */
export async function evaluarEnvio(id: string) {
  const modo = String(env.APROBACION_AUTO ?? "sombra");
  if (modo === "off") return null;
  const e = await env.DB.prepare("SELECT * FROM envios WHERE id = ?").bind(id).first<EnvioFila>();
  if (!e || e.estado !== "recibido") return null;
  const o = await env.ENVIOS.get(e.archivo_key);
  if (!o) { await guardar(id, [{ codigo: "sin_archivo", gravedad: "alta", detalle: "El archivo no está en el almacenamiento" }], null); return null; }

  let r: Extraido;
  try { r = await extraer(e.archivo_nombre, await o.arrayBuffer()); }
  catch (err) { await guardar(id, [{ codigo: "sin_texto", gravedad: "alta", detalle: err instanceof Error ? err.message.slice(0, 200) : "No se pudo leer el archivo" }], null); return null; }

  const paginas = r.paginas.map((p) => p.texto);
  const h: Hallazgo[] = analizarReglas(paginas);
  const hash = await huella(paginas);

  const repetido = await env.DB.prepare("SELECT id FROM envios WHERE texto_hash = ? AND id != ? LIMIT 1").bind(hash, id).first<{ id: string }>();
  if (repetido) h.push({ codigo: "duplicado_exacto", gravedad: "alta", detalle: "El mismo texto ya fue enviado antes" });

  // ¿Copia literal de algo que ya está en la biblioteca?
  try {
    const tramos = tramosParaCotejo(paginas, 8);
    const aciertos = new Map<string, number>();
    for (const t of tramos) {
      const { results } = await env.DB.prepare("SELECT DISTINCT libro FROM paginas_fts WHERE paginas_fts MATCH ?").bind(`"${t}"`).all<{ libro: string }>();
      for (const x of results) aciertos.set(x.libro, (aciertos.get(x.libro) ?? 0) + 1);
    }
    for (const [libro, n] of aciertos) if (n >= 3) h.push({ codigo: "solapamiento_biblioteca", gravedad: "alta", detalle: `${n} de ${tramos.length} fragmentos coinciden literalmente con «${libro}»` });
  } catch { /* si el cotejo falla, se sigue con lo demás */ }

  const recientes = await env.DB.prepare("SELECT COUNT(*) AS n FROM envios WHERE user_id = ? AND created_at >= ?").bind(e.user_id, new Date(Date.now() - 86_400_000).toISOString()).first<{ n: number }>();
  if ((recientes?.n ?? 0) > 3) h.push({ codigo: "muchos_envios", gravedad: "media", detalle: `${recientes?.n} envíos de esta cuenta en 24 horas` });

  h.push(...(await evaluarConIA(env.AI, muestras(paginas), { clasificar: env.MODELO_REVISION || MODELO_CLASIFICAR, seguridad: env.MODELO_SEGURIDAD || MODELO_SEGURIDAD })));

  const d = await guardar(id, h, hash);
  if (modo === "on" && d.veredicto === "auto_ok") await publicarEnvio(e, r, "auto");
  return d;
}
