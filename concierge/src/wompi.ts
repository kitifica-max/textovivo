// Cliente mínimo de Wompi El Salvador (https://docs.wompi.sv): token, enlace de pago y consulta de transacción.
// Las llaves (App ID y API Secret) son secretos del Worker; el mismo API Secret firma los webhooks.
import { env } from "cloudflare:workers";

const w = env as unknown as { WOMPI_APP_ID?: string; WOMPI_API_SECRET?: string; WOMPI_API_URL?: string; WOMPI_ID_URL?: string; WOMPI_MODO?: string };
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
