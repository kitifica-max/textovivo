// API del sitio: cuentas, acceso al conector, envíos de autores y revisión.
import { env } from "cloudflare:workers";
import catalogoJson from "../data/catalogo.json" with { type: "json" };
import {
  TERMINOS_VERSION, abrirSesion, aleatorio, cerrarSesion, claveCorrecta, cookieVacia, emailValido, hashClave, sha256, usuarioActual
} from "./auth.ts";
import { correoRestablecer, correoVerificacion, enviarCorreo } from "./correo.ts";
import { extraer } from "./extraer.ts";
import { evaluarEnvio, publicarEnvio, slug } from "./evaluacion.ts";
import { DIAS_PLAN, diasRestantes, extenderVencimiento, firmaValida, firmarToken, leerEvento, leerToken, montoCoincide, planEfectivo, separarNombre, validarTarjeta } from "./plan.ts";
import { apiSecret, crearEnlace, crearTransaccion3DS, ErrorWompi, modoPruebas, obtenerTransaccion, wompiConfigurado } from "./wompi.ts";
import { notaPaginas } from "./tools.ts";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
const error = (mensaje: string, status = 400) => json({ error: mensaje }, status);
const ahora = () => new Date().toISOString();
const uno = async <T>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<T>()) as T;
const todos = async <T>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const DIA = 86_400_000;

const TIPOS = ["libro", "documento", "tesis"];
const IDIOMAS = ["es", "en", "pt", "fr", "de", "it", "otro"];
const EXTENSIONES = /\.(pdf|txt|md)$/i;
// Tope por el proxy de Netlify, que corta las peticiones de ~8 MB en adelante.
const MAX_BYTES = 7 * 1024 * 1024;
const MAX_PENDIENTES = 10;

async function cuerpo(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;
  return (await req.json().catch(() => null)) as Record<string, unknown> | null;
}

const MAX_INTENTOS_IP_HORA = 10;     // intentos de tarjeta por IP y por hora
const FALLOS_PARA_PAUSA = 25;        // intentos fallidos en 10 minutos (en todo el sitio) que pausan el cobro con tarjeta
const ipCliente = (req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-nf-client-connection-ip") ?? "";
async function huellaIp(ip: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ip:" + ip));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
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
import { MAX_BYTES_DOC, MAX_BYTES_TOTAL, MAX_DOCS, MAX_PAGINAS, PREFIJO_PERSONAL, planHabilitado } from "./personales.ts";
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

/** Ids de los libros que la cuenta agregó a su biblioteca (solo los que siguen existiendo y visibles). */
async function misLibros(userId: string) {
  const { results } = await env.DB.prepare("SELECT libro_id FROM mis_libros WHERE user_id = ? ORDER BY created_at").bind(userId).all<{ libro_id: string }>();
  const dyn = new Set((await env.DB.prepare("SELECT id FROM libros_dyn WHERE visible = 1").all<{ id: string }>()).results.map((r) => r.id));
  return results.map((r) => r.libro_id).filter((id) => catalogoJson.some((d) => d.id === id) || dyn.has(id));
}
async function existeLibro(id: string) {
  if (catalogoJson.some((d) => d.id === id)) return true;
  return Boolean(await env.DB.prepare("SELECT 1 FROM libros_dyn WHERE id = ? AND visible = 1").bind(id).first());
}

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

// ---- Enlaces por correo (confirmar email, restablecer contraseña) ----
const HORAS_VERIFICAR = 24;
const HORAS_RESTABLECER = 1;
const MAX_CORREOS_POR_HORA = 3;

/** Dónde viven las páginas (para armar el enlace): el sitio desde el que llegó la petición, o SITIO_URL. */
const baseSitio = (req: Request, url: URL) => {
  const o = req.headers.get("origin");
  return o && (o === url.origin || env.ORIGENES_PERMITIDOS.split(",").map((x) => x.trim()).includes(o)) ? o : env.SITIO_URL;
};

async function correosRecientes(userId: string, tipo: string) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM enlaces_email WHERE user_id = ? AND tipo = ? AND created_at > ?")
    .bind(userId, tipo, new Date(Date.now() - 3_600_000).toISOString())
    .first<{ n: number }>();
  return r?.n ?? 0;
}

async function mandarEnlace(u: { id: string; email: string; nombre: string }, tipo: "verificar" | "restablecer", base: string) {
  const token = aleatorio(32);
  const horas = tipo === "verificar" ? HORAS_VERIFICAR : HORAS_RESTABLECER;
  await env.DB.prepare("INSERT INTO enlaces_email (token_hash, user_id, tipo, expira_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), u.id, tipo, new Date(Date.now() + horas * 3_600_000).toISOString(), ahora())
    .run();
  // El token va en el fragmento (#t=…): no llega a registros de servidores ni al Referer.
  const enlace = `${base}/${tipo === "verificar" ? "verificar" : "restablecer"}.html#t=${token}`;
  const c = tipo === "verificar" ? correoVerificacion(u.nombre, enlace) : correoRestablecer(u.nombre, enlace);
  return enviarCorreo(u.email, c.asunto, c.html, c.texto);
}

/** Consume un enlace válido (vigente y sin usar). Devuelve el usuario o null. */
async function consumirEnlace(token: unknown, tipo: string) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await sha256(token);
  const e = await env.DB.prepare("SELECT user_id FROM enlaces_email WHERE token_hash = ? AND tipo = ? AND usado_at IS NULL AND expira_at > ?")
    .bind(hash, tipo, ahora())
    .first<{ user_id: string }>();
  if (!e) return null;
  // UPDATE condicionado: si dos pestañas lo usan a la vez, solo una gana.
  const r = await env.DB.prepare("UPDATE enlaces_email SET usado_at = ? WHERE token_hash = ? AND usado_at IS NULL").bind(ahora(), hash).run();
  return r.meta.changes === 1 ? e.user_id : null;
}
const ENLACE_INVALIDO = "El enlace venció o ya se usó. Pedí uno nuevo.";

// ---- Cobro con Wompi: pago único de 30 días ----
type PagoFila = { id: string; user_id: string; monto: number; estado: string };

async function activarPago(p: PagoFila, idTransaccion: string) {
  const t = ahora();
  try {
    const r = await env.DB.prepare("UPDATE pagos SET estado = 'aprobado', transaccion_id = ?, aprobado_at = ? WHERE id = ? AND estado = 'pendiente'").bind(idTransaccion, t, p.id).run();
    if (!r.meta.changes) return false; // ya estaba aprobado: no se suma dos veces
  } catch { return false; } // esa transacción ya activó otro pago
  const u = await uno<{ plan: string; plan_vence_at: string | null }>("SELECT plan, plan_vence_at FROM users WHERE id = ?", p.user_id);
  if (u.plan !== "gratis" && !u.plan_vence_at) return true; // plan otorgado a mano, sin vencimiento: no se toca
  await env.DB.prepare("UPDATE users SET plan = 'pro', plan_vence_at = ?, plan_aviso = 0 WHERE id = ?").bind(extenderVencimiento(u.plan_vence_at, t), p.user_id).run();
  return true;
}

/** Confirma con Wompi (fuente de verdad) y activa el plan. Devuelve el estado del pago. */
async function confirmarPago(pagoId: string, idTransaccion: string, productiva: boolean | null = null) {
  const p = await uno<PagoFila | null>("SELECT id, user_id, monto, estado FROM pagos WHERE id = ?", pagoId);
  if (!p) return "desconocido";
  if (p.estado === "aprobado") return "aprobado";
  const t = await obtenerTransaccion(idTransaccion).catch(() => null);
  if (!t) return "pendiente";
  const real = modoPruebas() ? true : t.esReal === true && productiva !== false;
  if (t.esAprobada === true && real && montoCoincide(Number(t.monto ?? t.montoOriginal), p.monto)) await activarPago(p, idTransaccion);
  return (await uno<{ estado: string }>("SELECT estado FROM pagos WHERE id = ?", pagoId)).estado;
}

/** El hash del redirect (HMAC con el API Secret) confirma que Wompi no alteró los parámetros. */
async function hashRedirectValido(q: { pago?: string; transaccion?: string; enlace?: string; monto?: string; hash?: string }) {
  if (!q.hash) return false;
  return firmaValida(apiSecret(), `${q.pago ?? ""}${q.transaccion ?? ""}${q.enlace ?? ""}${q.monto ?? ""}`, q.hash);
}

/** Recibe la tarjeta, la valida, inicia la transacción 3DS en Wompi y devuelve la URL de verificación del banco. Nada de esto se guarda. */
async function pagarConTarjeta(req: Request): Promise<Response> {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return error("Solicitud inválida.");
  const t = await leerToken(apiSecret(), String(b.token ?? ""));
  if (!t) return error("Tu sesión de pago venció. Volvé a abrir el pago.", 401);
  const p = await uno<{ id: string; user_id: string; monto: number; estado: string; intentos: number; transaccion_id: string | null } | null>("SELECT id, user_id, monto, estado, intentos, transaccion_id FROM pagos WHERE id = ?", t.pagoId);
  if (!p || p.user_id !== t.userId) return error("Pago no encontrado.", 404);
  if (p.estado === "aprobado") return error("Este pago ya fue aprobado.", 409);
  if (p.transaccion_id) return error("Este pago ya se inició. Abrí un pago nuevo desde Mi biblioteca.", 409);
  if (p.intentos >= 3) return error("Demasiados intentos con este pago. Abrí uno nuevo desde Mi biblioteca.", 429);

  // Defensa contra pruebas masivas de tarjetas: tope por IP y freno automático si todo el sitio recibe muchos fallos seguidos.
  const ipH = await huellaIp(ipCliente(req));
  const porIp = await uno<{ n: number }>("SELECT COUNT(*) AS n FROM intentos_tarjeta WHERE ip_hash = ? AND created_at > ?", ipH, new Date(Date.now() - 3_600_000).toISOString());
  if (porIp.n >= MAX_INTENTOS_IP_HORA) return error("Demasiados intentos desde tu conexión. Probá de nuevo en una hora.", 429);
  const fallos = await uno<{ n: number }>("SELECT COUNT(*) AS n FROM intentos_tarjeta WHERE ok = 0 AND created_at > ?", new Date(Date.now() - 600_000).toISOString());
  if (fallos.n >= FALLOS_PARA_PAUSA) return error("El cobro con tarjeta está en pausa unos minutos por seguridad. Probá de nuevo en un rato.", 503);
  const intento = await env.DB.prepare("INSERT INTO intentos_tarjeta (ip_hash, created_at) VALUES (?, ?)").bind(ipH, ahora()).run();

  const falla = validarTarjeta({ numero: b.numero, cvv: b.cvv, mes: b.mes, anio: b.anio, nombre: b.nombre });
  if (falla) return error(falla);
  const u = await uno<{ email: string } | null>("SELECT email FROM users WHERE id = ?", p.user_id);
  if (!u) return error("Cuenta no encontrada.", 404);

  await env.DB.prepare("UPDATE pagos SET intentos = intentos + 1 WHERE id = ?").bind(p.id).run();
  const { nombre, apellido } = separarNombre(String(b.nombre));
  try {
    const r = await crearTransaccion3DS({
      monto: p.monto, email: u.email, nombre, apellido, referencia: p.id,
      tarjeta: { numero: String(b.numero).replace(/\D/g, ""), cvv: String(b.cvv).replace(/\D/g, ""), mes: Number(b.mes), anio: Number(b.anio) },
      urlRedirect: `${env.SITIO_URL}/pago/resultado.html?pago=${p.id}`, urlWebhook: `${env.SITIO_URL}/api/wompi/webhook`
    });
    await env.DB.prepare("UPDATE pagos SET transaccion_id = ?, enlace_url = ? WHERE id = ?").bind(r.idTransaccion, r.url3ds, p.id).run();
    await env.DB.prepare("UPDATE intentos_tarjeta SET ok = 1 WHERE id = ?").bind(intento.meta.last_row_id).run();
    return json({ ok: true, url3ds: r.url3ds });
  } catch (err) {
    return error(err instanceof ErrorWompi ? err.mensajeUsuario : "No pudimos procesar el pago. Probá de nuevo.", err instanceof ErrorWompi && err.estado === 400 ? 422 : 502);
  }
}

export async function api(req: Request, url: URL, ctx?: ExecutionContext): Promise<Response> {
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
    const enviado = await mandarEnlace({ id, email, nombre }, "verificar", baseSitio(req, url));
    return json({ ok: true, correo_enviado: enviado }, 201, { "set-cookie": await abrirSesion(id) });
  }

  if (post && ruta === "/api/login") {
    const b = await cuerpo(req);
    const email = String(b?.email ?? "").trim().toLowerCase();
    const clave = String(b?.clave ?? "");
    if (!emailValido(email) || !clave || clave.length > 200) return error("Email o contraseña incorrectos.", 401);
    if (!(await turnstileOk(b?.turnstile, req))) return error(ERROR_CAPTCHA, 400);

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

  if (post && ruta === "/api/verificar") {
    const b = await cuerpo(req);
    const userId = await consumirEnlace(b?.token, "verificar");
    if (!userId) return error(ENLACE_INVALIDO, 400);
    await env.DB.prepare("UPDATE users SET email_verificado_at = COALESCE(email_verificado_at, ?) WHERE id = ?").bind(ahora(), userId).run();
    return json({ ok: true });
  }

  if (post && ruta === "/api/recuperar") {
    const b = await cuerpo(req);
    const email = String(b?.email ?? "").trim().toLowerCase();
    if (!(await turnstileOk(b?.turnstile, req))) return error(ERROR_CAPTCHA, 400);
    if (!emailValido(email)) return error("Ese email no parece válido.");
    const u = await env.DB.prepare("SELECT id, email, nombre FROM users WHERE email = ?").bind(email).first<{ id: string; email: string; nombre: string }>();
    // Respuesta idéntica exista o no la cuenta: no se puede usar esto para averiguar qué emails están registrados.
    if (u && (await correosRecientes(u.id, "restablecer")) < MAX_CORREOS_POR_HORA) await mandarEnlace(u, "restablecer", baseSitio(req, url));
    return json({ ok: true });
  }

  if (post && ruta === "/api/restablecer") {
    const b = await cuerpo(req);
    const clave = String(b?.clave ?? "");
    if (clave.length < 10 || clave.length > 200) return error("La contraseña debe tener al menos 10 caracteres.");
    const userId = await consumirEnlace(b?.token, "restablecer");
    if (!userId) return error(ENLACE_INVALIDO, 400);
    const { hash, sal } = await hashClave(clave);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, email_verificado_at = COALESCE(email_verificado_at, ?) WHERE id = ?").bind(hash, sal, ahora(), userId),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId), // cierra todas las sesiones abiertas
      env.DB.prepare("DELETE FROM login_fallos WHERE email = (SELECT email FROM users WHERE id = ?)").bind(userId)
    ]);
    return json({ ok: true });
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

  // Pago con tarjeta: el formulario manda los datos DIRECTO a este Worker (no pasan por Netlify). Sin cookie: se autoriza con un token firmado.
  if (ruta === "/api/pago/tarjeta") {
    const origen = req.headers.get("origin") ?? "";
    const permitido = origen === url.origin || env.ORIGENES_PERMITIDOS.split(",").map((x) => x.trim()).includes(origen);
    const cors: Record<string, string> = permitido ? { "access-control-allow-origin": origen, vary: "origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } : {};
    const conCors = (r: Response) => { for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); r.headers.set("cache-control", "no-store"); return r; };
    if (req.method === "OPTIONS") return conCors(new Response(null, { status: permitido ? 204 : 403 }));
    if (!post || !permitido) return conCors(error("Origen no permitido", 403));
    return conCors(await pagarConTarjeta(req));
  }

  // Webhook de Wompi: sin sesión; se confía en la firma HMAC del cuerpo y, además, se confirma con la API de Wompi.
  if (post && ruta === "/api/wompi/webhook") {
    const crudo = await req.text();
    const firma = req.headers.get("wompi_hash");
    if (!firma) return error("Falta el encabezado wompi_hash", 401);
    if (!(await firmaValida(apiSecret(), crudo, firma))) return error("Firma inválida", 401);
    let evento = null;
    try { evento = leerEvento(JSON.parse(crudo)); } catch { /* cuerpo no JSON */ }
    if (evento) {
      // Con el formulario propio no hay enlace: el pago se identifica por la transacción que guardamos al iniciarla.
      const porTransaccion = await uno<{ id: string } | null>("SELECT id FROM pagos WHERE transaccion_id = ?", evento.idTransaccion);
      const pagoId = porTransaccion?.id ?? evento.pagoId;
      if (pagoId) await confirmarPago(pagoId, evento.idTransaccion, evento.esProductiva);
    }
    return json({ ok: true }); // siempre 200 con firma válida: así Wompi no reintenta eventos que no nos sirven
  }

  // ---- Desde acá hace falta sesión ----
  const u = await usuarioActual(req);
  if (!u) return error("Iniciá sesión para continuar.", 401);

  if (req.method === "GET" && ruta === "/api/yo") {
    const { results } = await env.DB.prepare("SELECT id, titulo, autor FROM libros_dyn WHERE visible = 1 ORDER BY publicado_at DESC").all<{ id: string; titulo: string; autor: string }>();
    const verificado = Boolean(u.email_verificado_at);
    return json({
      usuario: { nombre: u.nombre, email: u.email, verificado },
      // Sin email confirmado no se muestra el conector (y el servidor tampoco lo atiende).
      acceso: verificado ? vistaAcceso(await accesoDe(u.id), env.SITIO_URL) : null,
      libros: [...catalogoJson.map((d) => ({ id: d.id, titulo: d.titulo, autor: d.autor })), ...results],
      mis_libros: await misLibros(u.id),
      terminos_version: TERMINOS_VERSION
    });
  }

  // ---- Documentos personales: los sube la cuenta y solo ella los consulta ----
  if (ruta === "/api/documentos" || ruta.startsWith("/api/documentos/")) {
    const fp = await uno<{ plan: string; plan_vence_at: string | null }>("SELECT plan, plan_vence_at FROM users WHERE id = ?", u.id);
    const plan = planEfectivo(fp?.plan ?? "gratis", fp?.plan_vence_at ?? null);
    const habilitado = planHabilitado(plan, env.PLANES_PERSONALES ?? "");
    const lista = () => todos<{ id: string; titulo: string; archivo_nombre: string; paginas: number; bytes: number; created_at: string }>(
      "SELECT id, titulo, archivo_nombre, paginas, bytes, created_at FROM docs_personales WHERE user_id = ? ORDER BY created_at DESC", u.id);

    if (req.method === "GET" && ruta === "/api/documentos")
      return json({ plan, habilitado, vence: fp?.plan_vence_at ?? null, precio: Number(env.PRICE_USD), cobro_activo: wompiConfigurado(), limites: { max_docs: MAX_DOCS, max_bytes_doc: MAX_BYTES_DOC, max_bytes_total: MAX_BYTES_TOTAL }, documentos: await lista() });

    if (!habilitado) return error("Los documentos personales son una función de pago y todavía no está activa en tu cuenta.", 403);
    if (!u.email_verificado_at) return error("Confirmá tu email para subir documentos.", 403);

    if (post && ruta === "/api/documentos") {
      const f = await req.formData().catch(() => null);
      if (!f) return error("Formulario inválido.");
      const archivo = f.get("archivo");
      const tituloIn = String(f.get("titulo") ?? "").trim();
      if (String(f.get("acepto") ?? "") !== "on") return error("Confirmá que tenés derecho a usar este documento.");
      if (!(archivo instanceof File) || archivo.size === 0) return error("Adjuntá el archivo.");
      if (!EXTENSIONES.test(archivo.name)) return error("El archivo debe ser PDF, TXT o MD.");
      if (archivo.size > MAX_BYTES_DOC) return error("El archivo pesa más de 7 MB.");
      const actuales = await lista();
      if (actuales.length >= MAX_DOCS) return error(`Ya tenés ${MAX_DOCS} documentos. Borrá alguno para subir otro.`, 429);
      if (actuales.reduce((t, d) => t + d.bytes, 0) + archivo.size > MAX_BYTES_TOTAL) return error("Con este archivo pasarías el espacio total de tu cuenta. Borrá algún documento.", 429);
      const titulo = (tituloIn || archivo.name.replace(/\.[^.]+$/, "")).slice(0, 160);
      if (titulo.length < 2) return error("Ponele un título al documento.");

      let r;
      try { r = await extraer(archivo.name, await archivo.arrayBuffer()); } catch (e) { return error(e instanceof Error ? e.message : "No se pudo leer el archivo.", 422); }
      if (r.paginas.length > MAX_PAGINAS) return error(`El documento tiene ${r.paginas.length} páginas; el máximo es ${MAX_PAGINAS}.`, 422);

      const id = `${PREFIJO_PERSONAL}${aleatorio(10)}`;
      for (let i = 0; i < r.paginas.length; i += 50)
        await env.DB.batch(r.paginas.slice(i, i + 50).map((p) => env.DB.prepare("INSERT INTO paginas_fts (texto, libro, pagina) VALUES (?, ?, ?)").bind(p.texto, id, p.pagina)));
      await env.DB.prepare("INSERT INTO docs_personales (id, user_id, titulo, archivo_nombre, idioma, paginacion, indice, paginas, bytes, created_at) VALUES (?, ?, ?, ?, 'es', ?, ?, ?, ?, ?)")
        .bind(id, u.id, titulo, archivo.name.slice(0, 200), r.paginacion, JSON.stringify(r.indice), r.paginas.length, archivo.size, ahora()).run();
      return json({ ok: true, id, paginas: r.paginas.length, documentos: await lista() });
    }

    const borrar = ruta.match(/^\/api\/documentos\/(mi-[a-z0-9]{10})\/borrar$/);
    if (post && borrar) {
      // el user_id va en la condición: nadie puede borrar (ni ver) lo de otra cuenta
      const d = await uno<{ id: string }>("SELECT id FROM docs_personales WHERE id = ? AND user_id = ?", borrar[1], u.id);
      if (!d) return error("No encontrado", 404);
      await env.DB.batch([env.DB.prepare("DELETE FROM paginas_fts WHERE libro = ?").bind(d.id), env.DB.prepare("DELETE FROM docs_personales WHERE id = ? AND user_id = ?").bind(d.id, u.id)]);
      return json({ ok: true, documentos: await lista() });
    }
    return error("No encontrado", 404);
  }

  // ---- Plan y pago ----
  if (req.method === "GET" && ruta === "/api/plan") {
    const r = await uno<{ plan: string; plan_vence_at: string | null }>("SELECT plan, plan_vence_at FROM users WHERE id = ?", u.id);
    return json({ plan: planEfectivo(r.plan, r.plan_vence_at), vence: r.plan_vence_at, dias_restantes: diasRestantes(r.plan_vence_at), precio: Number(env.PRICE_USD), moneda: "USD", dias: DIAS_PLAN, cobro_activo: wompiConfigurado() });
  }

  if (post && ruta === "/api/pago/crear") {
    if (!u.email_verificado_at) return error("Confirmá tu email antes de pagar.", 403);
    if (!wompiConfigurado()) return error("El cobro todavía no está activo.", 503);
    const recientes = await uno<{ n: number }>("SELECT COUNT(*) AS n FROM pagos WHERE user_id = ? AND estado = 'pendiente' AND created_at > ?", u.id, new Date(Date.now() - 3_600_000).toISOString());
    if (recientes.n >= 5) return error("Ya generaste varios pagos en la última hora. Usá el último enlace o esperá un rato.", 429);
    const id = aleatorio(8), monto = Number(env.PRICE_USD), producto = `Textifika Pro · ${DIAS_PLAN} días`;
    await env.DB.prepare("INSERT INTO pagos (id, user_id, producto, monto, modo, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, u.id, producto, monto, modoPruebas() ? "pruebas" : "produccion", ahora()).run();
    try {
      // Redirect y webhook en el dominio propio: Netlify reenvía /api/* al Worker. Si algún día el proxy descartara el encabezado
      // wompi_hash (lleva guion bajo), el webhook respondería «Falta el encabezado»; en ese caso basta usar PUBLIC_URL aquí.
      const e = await crearEnlace({ pagoId: id, monto, nombreProducto: producto, urlRedirect: `${env.SITIO_URL}/pago/resultado.html`, urlWebhook: `${env.SITIO_URL}/api/wompi/webhook` });
      await env.DB.prepare("UPDATE pagos SET enlace_id = ?, enlace_url = ? WHERE id = ?").bind(e.idEnlace, e.urlEnlace, id).run();
      return json({ ok: true, pago: id, url: e.urlEnlace });
    } catch (err) {
      console.error("pago/crear", err);
      return error("No pudimos crear el enlace de pago. Probá de nuevo en unos minutos.", 502);
    }
  }

  if (post && ruta === "/api/pago/iniciar") {
    const bi = (await req.json().catch(() => ({}))) as { turnstile?: string };
    if (!(await turnstileOk(bi.turnstile, req))) return error(ERROR_CAPTCHA, 400);
    if (!u.email_verificado_at) return error("Confirmá tu email antes de pagar.", 403);
    if (!wompiConfigurado()) return error("El cobro todavía no está activo.", 503);
    const recientes = await uno<{ n: number }>("SELECT COUNT(*) AS n FROM pagos WHERE user_id = ? AND estado = 'pendiente' AND created_at > ?", u.id, new Date(Date.now() - 3_600_000).toISOString());
    if (recientes.n >= 5) return error("Ya iniciaste varios pagos en la última hora. Esperá un rato e intentá de nuevo.", 429);
    const id = aleatorio(8), monto = Number(env.PRICE_USD), producto = `Textifika Pro · ${DIAS_PLAN} días`;
    await env.DB.prepare("INSERT INTO pagos (id, user_id, producto, monto, modo, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, u.id, producto, monto, modoPruebas() ? "pruebas" : "produccion", ahora()).run();
    // «destino»: dónde se envía la tarjeta (directo al Worker). Con el mismo origen no hace falta CORS.
    return json({ ok: true, pago: id, token: await firmarToken(apiSecret(), id, u.id), destino: `${env.PUBLIC_URL}/api/pago/tarjeta`, monto, producto, nombre: u.nombre, email: u.email });
  }

  if (post && ruta === "/api/pago/estado") {
    const b = (await req.json().catch(() => ({}))) as { pago?: string; transaccion?: string; enlace?: string; monto?: string; hash?: string };
    const p = b.pago ? await uno<PagoFila | null>("SELECT id, user_id, monto, estado FROM pagos WHERE id = ? AND user_id = ?", b.pago, u.id) : null;
    if (!p) return error("No encontrado", 404);
    let estado = p.estado;
    if (estado === "pendiente") {
      const guardada = await uno<{ transaccion_id: string | null }>("SELECT transaccion_id FROM pagos WHERE id = ?", p.id);
      if (guardada.transaccion_id) estado = await confirmarPago(p.id, guardada.transaccion_id);      // formulario propio
      else if (b.transaccion && (await hashRedirectValido(b))) estado = await confirmarPago(p.id, b.transaccion); // enlace de pago
    }
    const r = await uno<{ plan: string; plan_vence_at: string | null }>("SELECT plan, plan_vence_at FROM users WHERE id = ?", u.id);
    return json({ estado, plan: planEfectivo(r.plan, r.plan_vence_at), vence: r.plan_vence_at });
  }

  // ---- Biblioteca personal: agregar y quitar libros ----
  if (post && (ruta === "/api/mis-libros" || ruta === "/api/mis-libros/quitar")) {
    const { libro } = (await req.json().catch(() => ({}))) as { libro?: string };
    if (!libro || !(await existeLibro(libro))) return error("Ese libro no existe.", 404);
    if (ruta === "/api/mis-libros") {
      await env.DB.prepare("INSERT OR IGNORE INTO mis_libros (user_id, libro_id, created_at) VALUES (?, ?, ?)").bind(u.id, libro, ahora()).run();
    } else {
      await env.DB.prepare("DELETE FROM mis_libros WHERE user_id = ? AND libro_id = ?").bind(u.id, libro).run();
    }
    return json({ ok: true, mis_libros: await misLibros(u.id) });
  }

  if (post && ruta === "/api/reenviar") {
    if (u.email_verificado_at) return error("Tu email ya está confirmado.", 409);
    if ((await correosRecientes(u.id, "verificar")) >= MAX_CORREOS_POR_HORA)
      return error("Ya te mandamos varios correos en la última hora. Revisá tu bandeja (y el spam) y probá de nuevo más tarde.", 429);
    const ok = await mandarEnlace(u, "verificar", baseSitio(req, url));
    return ok ? json({ ok: true }) : error("No pudimos enviar el correo. Probá de nuevo en unos minutos.", 502);
  }

  if (post && ruta === "/api/renovar") {
    const a = await accesoDe(u.id);
    if (!a) {
      await crearAcceso(u.id, u.email);
      return json({ ok: true });
    }
    const v = vistaAcceso(a, env.SITIO_URL)!;
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
    if (!u.email_verificado_at) return error("Confirmá tu email para subir obras. Te mandamos un correo al crear la cuenta.", 403);
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
    if (archivo.size > MAX_BYTES) return error("El archivo pesa más de 7 MB.");

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
    // Revisión automática en segundo plano: no hace esperar a quien sube.
    ctx?.waitUntil(evaluarEnvio(id).catch((err) => console.error("evaluarEnvio", err)));
    return json({ ok: true, id }, 201);
  }

  return error("No encontrado", 404);
}

// ---- Revisión (solo con el secreto de admin) ----
type Envio = {
  id: string; user_id: string; titulo: string; autor_nombre: string; tipo: string; idioma: string; descripcion: string;
  archivo_key: string; archivo_nombre: string; estado: string; libro_id: string | null;
};

export async function adminEnvios(req: Request, url: URL): Promise<Response> {
  const ruta = url.pathname;

  if (req.method === "GET" && ruta === "/admin/envios") {
    const estado = url.searchParams.get("estado");
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.titulo, e.autor_nombre, e.tipo, e.idioma, e.descripcion, e.archivo_nombre, e.archivo_bytes, e.estado,
              e.created_at, e.revisado_at, e.nota, e.libro_id, e.terms_version, e.dominio_publico_at, e.veredicto, e.puntaje, e.motivos, e.evaluado_at, e.aprobado_por, u.email, u.nombre AS cuenta
         FROM envios e JOIN users u ON u.id = e.user_id
        ${estado ? "WHERE e.estado = ?1" : ""} ORDER BY e.created_at DESC LIMIT 200`
    )
      .bind(...(estado ? [estado] : []))
      .all();
    return json(results);
  }

  const m = ruta.match(/^\/admin\/envios\/([a-f0-9]{16})\/(archivo|aprobar|retirar|evaluar)$/);
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

  if (m[2] === "evaluar") {
    // Vuelve a correr la revisión automática (útil para calibrar o para envíos anteriores al sistema).
    const d = await evaluarEnvio(e.id);
    return json({ ok: true, resultado: d });
  }

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
    const libroId = await publicarEnvio(e, r, "manual");
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
