// Cliente mínimo de Wompi El Salvador (https://docs.wompi.sv): token, enlace de pago y consulta de transacción.
// Las llaves (App ID y API Secret) son secretos del Worker; el mismo API Secret firma los webhooks.
import { env } from "cloudflare:workers";

const w = env as unknown as { WOMPI_APP_ID?: string; WOMPI_API_SECRET?: string; WOMPI_API_URL?: string; WOMPI_ID_URL?: string; WOMPI_MODO?: string; WOMPI_CIUDAD?: string; WOMPI_DIRECCION?: string; WOMPI_PAIS?: string; WOMPI_REGION?: string; WOMPI_CODIGO_POSTAL?: string; WOMPI_TELEFONO?: string };
export const apiSecret = () => w.WOMPI_API_SECRET ?? "";
export const wompiConfigurado = () => Boolean(w.WOMPI_APP_ID && w.WOMPI_API_SECRET);
/** «pruebas»: se aceptan pagos de desarrollo (esReal = false). «produccion»: solo pagos reales. */
export const modoPruebas = () => (w.WOMPI_MODO ?? "pruebas") !== "produccion";

let cache: { valor: string; vence: number } | null = null;

async function token() {
  if (cache && cache.vence > Date.now() + 60_000) return cache.valor;
  const r = await fetch(`${w.WOMPI_ID_URL ?? "https://id.wompi.sv"}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", audience: "wompi_api", client_id: w.WOMPI_APP_ID ?? "", client_secret: w.WOMPI_API_SECRET ?? "" })
  });
  if (!r.ok) throw new Error(`Wompi no dio el token (${r.status})`);
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Wompi no devolvió el token");
  cache = { valor: j.access_token, vence: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cache.valor;
}

const api = async (ruta: string, init: RequestInit = {}) =>
  fetch(`${w.WOMPI_API_URL ?? "https://api.wompi.sv"}${ruta}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await token()}`, "content-type": "application/json" } });

export async function crearEnlace(a: { pagoId: string; monto: number; nombreProducto: string; urlRedirect: string; urlWebhook: string }) {
  const r = await api("/EnlacePago", {
    method: "POST",
    body: JSON.stringify({
      identificadorEnlaceComercio: a.pagoId,
      monto: a.monto,
      nombreProducto: a.nombreProducto,
      configuracion: { urlRedirect: a.urlRedirect, urlWebhook: a.urlWebhook, notificarTransaccionCliente: true }
    })
  });
  if (!r.ok) throw new Error(`Wompi no creó el enlace (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { idEnlace?: string | number; urlEnlace?: string };
  if (!j.urlEnlace) throw new Error("Wompi no devolvió la URL del enlace");
  return { idEnlace: String(j.idEnlace ?? ""), urlEnlace: j.urlEnlace };
}

export type TransaccionWompi = { esAprobada?: boolean; esReal?: boolean; monto?: number; montoOriginal?: number; idTransaccion?: string };
/** Fuente de verdad: Wompi responde si la transacción existe, fue aprobada, es real y de qué monto. */
export async function obtenerTransaccion(id: string): Promise<TransaccionWompi | null> {
  const r = await api(`/TransaccionCompra/${encodeURIComponent(id)}`);
  return r.ok ? ((await r.json()) as TransaccionWompi) : null;
}

export type Tarjeta3DS = { numero: string; cvv: string; mes: number; anio: number };
export class ErrorWompi extends Error { constructor(public mensajeUsuario: string, public estado: number) { super(`Wompi ${estado}`); } }

/**
 * Cobro con 3D Secure: Wompi devuelve la URL donde el cliente completa la verificación con su banco.
 * IMPORTANTE: los datos de la tarjeta no se registran ni se guardan en ningún lado, ni siquiera en errores.
 */
export async function crearTransaccion3DS(a: { monto: number; email: string; nombre: string; apellido: string; tarjeta: Tarjeta3DS; urlRedirect: string; urlWebhook: string; referencia: string }) {
  const cuerpo = (clave: string) => JSON.stringify({
    monto: a.monto, email: a.email, nombre: a.nombre, apellido: a.apellido,
    ciudad: w.WOMPI_CIUDAD ?? "San Salvador", direccion: w.WOMPI_DIRECCION ?? "San Salvador", idPais: w.WOMPI_PAIS ?? "SV",
    idRegion: w.WOMPI_REGION ?? "SV-SS", codigoPostal: w.WOMPI_CODIGO_POSTAL ?? "1101", telefono: w.WOMPI_TELEFONO ?? "70000000",
    [clave]: { numeroTarjeta: a.tarjeta.numero, cvv: a.tarjeta.cvv, mesVencimiento: a.tarjeta.mes, anioVencimiento: a.tarjeta.anio },
    urlRedirect: a.urlRedirect,
    configuracion: { urlWebhook: a.urlWebhook, urlRedirect: a.urlRedirect, notificarTransaccionCliente: true },
    datosAdicionales: { pago: a.referencia }
  });
  // La documentación escribe el campo de dos maneras («tarjetaCreditoDebito» y «tarjetaCreditoDebido»): se prueba la de la tabla y, si Wompi la rechaza, la del ejemplo.
  let r = await api("/TransaccionCompra/3DS", { method: "POST", body: cuerpo("tarjetaCreditoDebito") });
  if (r.status === 400) r = await api("/TransaccionCompra/3DS", { method: "POST", body: cuerpo("tarjetaCreditoDebido") });
  if (!r.ok) {
    let msg = "";
    try { const j = (await r.json()) as { mensaje?: string; message?: string; error?: string }; msg = String(j.mensaje ?? j.message ?? j.error ?? ""); } catch { /* sin cuerpo */ }
    console.error(`Wompi 3DS respondió ${r.status}`); // solo el código: nunca el cuerpo
    throw new ErrorWompi(r.status === 400 && msg && !/\d{12,}/.test(msg) ? msg.slice(0, 140) : "El banco no pudo procesar la tarjeta. Revisá los datos o probá con otra.", r.status);
  }
  const j = (await r.json()) as { idTransaccion?: string; urlCompletarPago3Ds?: string; esReal?: boolean };
  if (!j.idTransaccion || !j.urlCompletarPago3Ds) throw new ErrorWompi("No pudimos iniciar la verificación con tu banco. Probá de nuevo.", 502);
  return { idTransaccion: String(j.idTransaccion), url3ds: j.urlCompletarPago3Ds, esReal: j.esReal === true };
}
