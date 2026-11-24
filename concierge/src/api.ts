// API del sitio: cuentas, acceso al conector, envíos de autores y revisión.
import { env } from "cloudflare:workers";
import catalogoJson from "../data/catalogo.json" with { type: "json" };
import {
  TERMINOS_VERSION, abrirSesion, aleatorio, cerrarSesion, claveCorrecta, cookieVacia, emailValido, hashClave, usuarioActual
} from "./auth.ts";
import { extraer } from "./extraer.ts";
import { notaPaginas } from "./tools.ts";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
const error = (mensaje: string, status = 400) => json({ error: mensaje }, status);
const ahora = () => new Date().toISOString();
const DIA = 86_400_000;

const TIPOS = ["libro", "documento", "tesis"];
const IDIOMAS = ["es", "en", "pt", "fr", "de", "it", "otro"];
const EXTENSIONES = /\.(pdf|txt|md)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PENDIENTES = 10;

async function cuerpo(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;
  return (await req.json().catch(() => null)) as Record<string, unknown> | null;
}

/** Turnstile: el token lo genera el widget en el navegador y se valida acá con la clave secreta. */
async function turnstileOk(token: unknown, req: Request) {
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return false;
  const datos = new FormData();
  datos.set("secret", env.TURNSTILE_SECRET);
  datos.set("response", token);
  // Detrás del proxy de Netlify, la IP del visitante viene en este header; si no, la que ve Cloudflare.
  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("cf-connecting-ip");
  if (ip) datos.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: datos }).catch(() => null);
  const j = r?.ok ? ((await r.json().catch(() => null)) as { success?: boolean } | null) : null;
  return j?.success === true;
}
const ERROR_CAPTCHA = "No pudimos verificar que sos una persona. Esperá a que termine la verificación y probá de nuevo.";

/**
 * Defensa extra contra CSRF: si el navegador manda Origin, tiene que ser este sitio o uno de ORIGENES_PERMITIDOS
 * (el sitio publicado en Netlify, que reenvía /api/* a este Worker).
 */
const mismoOrigen = (req: Request, url: URL) => {
  const o = req.headers.get("origin");
  if (!o || o === url.origin) return true;
  return env.ORIGENES_PERMITIDOS.split(",").map((x) => x.trim()).filter(Boolean).includes(o);
};

async function crearAcceso(userId: string, email: string) {
  const token = crypto.randomUUID().replaceAll("-", "");
  const creado = new Date();
  const vence = new Date(creado.getTime() + Number(env.RENTAL_DAYS) * DIA);
  await env.DB.prepare("INSERT INTO buyers (token, email, es_prueba, created_at, expires_at, user_id) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(token, email, creado.toISOString(), vence.toISOString(), userId)
    .run();
}

type Acceso = { token: string; expires_at: string; calls: number; last_call_at: string | null };
const accesoDe = (userId: string) =>
  env.DB.prepare("SELECT token, expires_at, calls, last_call_at FROM buyers WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .first<Acceso>();

function vistaAcceso(a: Acceso | null, origin: string) {
  if (!a) return null;
  const dias = Math.ceil((new Date(a.expires_at).getTime() - Date.now()) / DIA);
  return {
    url_mcp: `${origin}/c/${a.token}/mcp`,
    vence: a.expires_at,
    dias_restantes: Math.max(0, dias),
    vencido: a.expires_at <= ahora(),
    consultas_usadas: a.calls,
    consultas_limite: Number(env.CALLS_PER_TOKEN),
    ultima_consulta: a.last_call_at
  };
}

export async function api(req: Request, url: URL): Promise<Response> {
  const ruta = url.pathname;
  const post = req.method === "POST";
  if (post && !mismoOrigen(req, url)) return error("Origen no permitido", 403);

  if (req.method === "GET" && ruta === "/api/config") return json({ turnstile_site_key: env.TURNSTILE_SITE_KEY }, 200, { "cache-control": "public, max-age=300" });

  // ---- Cuentas ----
  if (post && ruta === "/api/registro") {
    const b = await cuerpo(req);
    const email = String(b?.email ?? "").trim().toLowerCase();
    const nombre = String(b?.nombre ?? "").trim();
    const clave = String(b?.clave ?? "");
    if (b?.acepto_terminos !== true) return error("Tenés que aceptar los términos y condiciones para crear la cuenta.");
    if (!(await turnstileOk(b?.turnstile, req))) return error(ERROR_CAPTCHA, 400);
    if (!emailValido(email)) return error("Ese email no parece válido.");
    if (nombre.length < 2 || nombre.length > 100) return error("Escribí tu nombre (entre 2 y 100 caracteres).");
    if (clave.length < 10 || clave.length > 200) return error("La contraseña debe tener al menos 10 caracteres.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first())
      return error("Ese email ya tiene una cuenta. Iniciá sesión.", 409);

    const id = crypto.randomUUID();
    const { hash, sal } = await hashClave(clave);
    await env.DB.prepare(
      "INSERT INTO users (id, email, nombre, pass_hash, pass_salt, terms_version, terms_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(id, email, nombre, hash, sal, TERMINOS_VERSION, ahora(), ahora())
      .run();
    await crearAcceso(id, email);
    return json({ ok: true }, 201, { "set-cookie": await abrirSesion(id) });
  }

  if (post && ruta === "/api/login") {
    const b = await cuerpo(req);
    const email = String(b?.email ?? "").trim().toLowerCase();
    const clave = String(b?.clave ?? "");
    if (!emailValido(email) || !clave || clave.length > 200) return error("Email o contraseña incorrectos.", 401);

    const f = await env.DB.prepare("SELECT fallos, bloqueado_hasta FROM login_fallos WHERE email = ?")
      .bind(email)
      .first<{ fallos: number; bloqueado_hasta: string | null }>();
    if (f?.bloqueado_hasta && f.bloqueado_hasta > ahora()) return error("Demasiados intentos. Esperá 15 minutos y probá de nuevo.", 429);

    const u = await env.DB.prepare("SELECT id, pass_hash, pass_salt FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string; pass_hash: string; pass_salt: string }>();
    // Con un email inexistente igual se hace el cálculo, para que la demora no delate qué emails tienen cuenta.
    const ok = u ? await claveCorrecta(clave, u.pass_hash, u.pass_salt) : (await hashClave(clave), false);
    if (!u || !ok) {
      const n = (f?.fallos ?? 0) + 1;
      await env.DB.prepare(
        "INSERT INTO login_fallos (email, fallos, bloqueado_hasta) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET fallos = ?2, bloqueado_hasta = ?3"
      )
        .bind(email, n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null)
        .run();
      return error("Email o contraseña incorrectos.", 401);
    }
    await env.DB.prepare("DELETE FROM login_fallos WHERE email = ?").bind(email).run();
    return json({ ok: true }, 200, { "set-cookie": await abrirSesion(u.id) });
  }

  if (post && ruta === "/api/logout") {
    await cerrarSesion(req);
    return json({ ok: true }, 200, { "set-cookie": cookieVacia });
  }

  // ---- Biblioteca pública de aportes (sin sesión) ----
  if (req.method === "GET" && ruta === "/api/libros") {
    const { results } = await env.DB.prepare(
      "SELECT id, titulo, autor, tipo, idioma, descripcion, paginas, publicado_at FROM libros_dyn WHERE visible = 1 ORDER BY publicado_at DESC"
    ).all();
    return json(results, 200, { "cache-control": "public, max-age=60" });
  }
  const unLibro = ruta.match(/^\/api\/libros\/([a-z0-9-]{3,80})$/);
  if (req.method === "GET" && unLibro) {
    const l = await env.DB.prepare("SELECT * FROM libros_dyn WHERE id = ? AND visible = 1").bind(unLibro[1]).first<Record<string, string | number>>();
    if (!l) return error("No encontrado", 404);
    return json({ ...l, indice: JSON.parse(String(l.indice)), nota_paginas: notaPaginas({ paginacion: l.paginacion as "logica" | "pdf" }) }, 200, {
      "cache-control": "public, max-age=60"
    });
  }

  // ---- Desde acá hace falta sesión ----
  const u = await usuarioActual(req);
  if (!u) return error("Iniciá sesión para continuar.", 401);

  if (req.method === "GET" && ruta === "/api/yo") {
    const { results } = await env.DB.prepare("SELECT id, titulo, autor FROM libros_dyn WHERE visible = 1 ORDER BY publicado_at DESC").all<{ id: string; titulo: string; autor: string }>();
    return json({
      usuario: { nombre: u.nombre, email: u.email },
      acceso: vistaAcceso(await accesoDe(u.id), url.origin),
      libros: [...catalogoJson.map((d) => ({ id: d.id, titulo: d.titulo, autor: d.autor })), ...results],
      terminos_version: TERMINOS_VERSION
    });
  }

  if (post && ruta === "/api/renovar") {
    const a = await accesoDe(u.id);
    if (!a) {
      await crearAcceso(u.id, u.email);
      return json({ ok: true });
    }
    const v = vistaAcceso(a, url.origin)!;
    if (!v.vencido && v.dias_restantes > 7) return error("Tu acceso todavía tiene más de 7 días: podés renovarlo cuando le queden menos.", 409);
    await env.DB.prepare("UPDATE buyers SET expires_at = ?, calls = 0 WHERE token = ?")
      .bind(new Date(Date.now() + Number(env.RENTAL_DAYS) * DIA).toISOString(), a.token)
      .run();
    return json({ ok: true });
  }

  // ---- Envíos de autores ----
  if (req.method === "GET" && ruta === "/api/envios") {
    const { results } = await env.DB.prepare(
      "SELECT id, titulo, tipo, estado, created_at, revisado_at, libro_id FROM envios WHERE user_id = ? ORDER BY created_at DESC"
    )
      .bind(u.id)
      .all();
    return json(results);
  }

  if (post && ruta === "/api/envios") {
    const f = await req.formData().catch(() => null);
    if (!f) return error("Formulario inválido.");
    const campo = (k: string) => String(f.get(k) ?? "").trim();
    const titulo = campo("titulo");
    const autor = campo("autor_nombre");
    const tipo = campo("tipo");
    const idioma = campo("idioma");
    const descripcion = campo("descripcion");
    const archivo = f.get("archivo");

    if (!(await turnstileOk(f.get("cf-turnstile-response"), req))) return error(ERROR_CAPTCHA, 400);
    if (campo("acepto_terminos") !== "on") return error("Tenés que aceptar los términos y condiciones.");
    if (campo("dominio_publico") !== "on") return error("Tenés que declarar que sos titular de los derechos y aceptar que la obra pase al dominio público.");
    if (titulo.length < 3 || titulo.length > 200) return error("El título debe tener entre 3 y 200 caracteres.");
    if (autor.length < 2 || autor.length > 120) return error("Escribí el nombre del autor (entre 2 y 120 caracteres).");
    if (!TIPOS.includes(tipo)) return error("Elegí si es libro, documento o tesis.");
    if (!IDIOMAS.includes(idioma)) return error("Elegí el idioma.");
    if (descripcion.length < 20 || descripcion.length > 1000) return error("La descripción debe tener entre 20 y 1000 caracteres.");
    if (!(archivo instanceof File) || archivo.size === 0) return error("Adjuntá el archivo.");
    if (!EXTENSIONES.test(archivo.name)) return error("El archivo debe ser PDF, TXT o MD.");
    if (archivo.size > MAX_BYTES) return error("El archivo pesa más de 20 MB.");

    const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM envios WHERE user_id = ? AND estado = 'recibido'").bind(u.id).first<{ n: number }>();
    if ((pend?.n ?? 0) >= MAX_PENDIENTES) return error(`Ya tenés ${MAX_PENDIENTES} envíos esperando revisión. Esperá a que se revisen para subir más.`, 429);

    const id = aleatorio(8);
    const nombre = archivo.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const key = `envios/${id}/${nombre}`;
    await env.ENVIOS.put(key, archivo.stream(), { httpMetadata: { contentType: archivo.type || "application/octet-stream" }, customMetadata: { user: u.id } });
    await env.DB.prepare(
      `INSERT INTO envios (id, user_id, titulo, autor_nombre, tipo, idioma, descripcion, archivo_key, archivo_nombre, archivo_bytes,
                           terms_version, terms_accepted_at, dominio_publico_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, u.id, titulo, autor, tipo, idioma, descripcion, key, archivo.name.slice(0, 200), archivo.size, TERMINOS_VERSION, ahora(), ahora(), ahora())
      .run();
    return json({ ok: true, id }, 201);
  }

  return error("No encontrado", 404);
}

// ---- Revisión (solo con el secreto de admin) ----
type Envio = {
  id: string; user_id: string; titulo: string; autor_nombre: string; tipo: string; idioma: string; descripcion: string;
  archivo_key: string; archivo_nombre: string; estado: string; libro_id: string | null;
};

const slug = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "obra";

export async function adminEnvios(req: Request, url: URL): Promise<Response> {
  const ruta = url.pathname;

  if (req.method === "GET" && ruta === "/admin/envios") {
    const estado = url.searchParams.get("estado");
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.titulo, e.autor_nombre, e.tipo, e.idioma, e.descripcion, e.archivo_nombre, e.archivo_bytes, e.estado,
              e.created_at, e.revisado_at, e.nota, e.libro_id, e.terms_version, e.dominio_publico_at, u.email, u.nombre AS cuenta
         FROM envios e JOIN users u ON u.id = e.user_id
        ${estado ? "WHERE e.estado = ?1" : ""} ORDER BY e.created_at DESC LIMIT 200`
    )
      .bind(...(estado ? [estado] : []))
      .all();
    return json(results);
  }

  const m = ruta.match(/^\/admin\/envios\/([a-f0-9]{16})\/(archivo|aprobar|retirar)$/);
  if (!m) return error("No encontrado", 404);
  const e = await env.DB.prepare("SELECT * FROM envios WHERE id = ?").bind(m[1]).first<Envio>();
  if (!e) return error("No encontrado", 404);

  if (req.method === "GET" && m[2] === "archivo") {
    const o = await env.ENVIOS.get(e.archivo_key);
    if (!o) return error("El archivo no está en el almacenamiento", 404);
    return new Response(o.body, {
      headers: { "content-type": o.httpMetadata?.contentType ?? "application/octet-stream", "content-disposition": `attachment; filename="${e.archivo_nombre.replace(/"/g, "")}"` }
    });
  }

  if (req.method !== "POST") return error("Método no permitido", 405);

  if (m[2] === "aprobar") {
    if (e.estado === "aprobado") return error("Ya está aprobado", 409);
    const o = await env.ENVIOS.get(e.archivo_key);
    if (!o) return error("El archivo no está en el almacenamiento", 404);
    let r;
    try {
      r = await extraer(e.archivo_nombre, await o.arrayBuffer());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo leer el archivo";
      await env.DB.prepare("UPDATE envios SET nota = ? WHERE id = ?").bind(msg.slice(0, 500), e.id).run();
      return error(msg, 422);
    }
    const libroId = `u-${slug(e.titulo)}-${e.id.slice(0, 6)}`;
    await env.DB.prepare("DELETE FROM paginas_fts WHERE libro = ?").bind(libroId).run();
    for (let i = 0; i < r.paginas.length; i += 50)
      await env.DB.batch(
        r.paginas.slice(i, i + 50).map((p) => env.DB.prepare("INSERT INTO paginas_fts (texto, libro, pagina) VALUES (?, ?, ?)").bind(p.texto, libroId, p.pagina))
      );
    const t = ahora();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR REPLACE INTO libros_dyn (id, envio_id, titulo, autor, tipo, idioma, descripcion, paginacion, indice, paginas, publicado_at, visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(libroId, e.id, e.titulo, e.autor_nombre, e.tipo, e.idioma, e.descripcion, r.paginacion, JSON.stringify(r.indice), r.paginas.length, t),
      env.DB.prepare("UPDATE envios SET estado = 'aprobado', revisado_at = ?, libro_id = ?, nota = NULL WHERE id = ?").bind(t, libroId, e.id)
    ]);
    return json({ ok: true, libro_id: libroId, paginas: r.paginas.length });
  }

  // retirar: solo para contenido ilegal o que infringe derechos de terceros (ver términos, sección 7)
  const b = await cuerpo(req);
  const motivo = String(b?.motivo ?? "").trim().slice(0, 500);
  if (!motivo) return error("Falta el motivo del retiro");
  const stmts = [env.DB.prepare("UPDATE envios SET estado = 'retirado', revisado_at = ?, nota = ? WHERE id = ?").bind(ahora(), motivo, e.id)];
  if (e.libro_id) {
    stmts.push(env.DB.prepare("UPDATE libros_dyn SET visible = 0 WHERE id = ?").bind(e.libro_id));
    stmts.push(env.DB.prepare("DELETE FROM paginas_fts WHERE libro = ?").bind(e.libro_id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}
