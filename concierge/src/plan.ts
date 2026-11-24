// Plan con vencimiento y verificación de firmas de Wompi: funciones puras (se prueban sin base de datos ni red).
export const DIAS_PLAN = 30;
const DIA_MS = 86_400_000;

/** Plan que vale hoy: el contratado, salvo que haya vencido. Sin fecha de vencimiento = otorgado a mano, no vence. */
export function planEfectivo(plan: string, venceAt: string | null, ahora = new Date().toISOString()) {
  if (!plan || plan === "gratis") return "gratis";
  return venceAt && venceAt <= ahora ? "gratis" : plan;
}

/** Cada pago suma 30 días; si todavía queda plan vigente, se suman al final (renovar antes no pierde días). */
export function extenderVencimiento(venceAt: string | null, ahora = new Date().toISOString(), dias = DIAS_PLAN) {
  const base = venceAt && venceAt > ahora ? venceAt : ahora;
  return new Date(new Date(base).getTime() + dias * DIA_MS).toISOString();
}

export const diasRestantes = (venceAt: string | null, ahora = new Date().toISOString()) =>
  venceAt ? Math.max(0, Math.ceil((new Date(venceAt).getTime() - new Date(ahora).getTime()) / DIA_MS)) : null;

/** Qué aviso toca enviar: 1 a 7 días del vencimiento, 2 a 1 día. Solo avanza (nunca repite). */
export function avisoPendiente(venceAt: string | null, avisoEnviado: number, ahora = new Date().toISOString()): 0 | 1 | 2 {
  if (!venceAt || venceAt <= ahora) return 0;
  const d = (new Date(venceAt).getTime() - new Date(ahora).getTime()) / DIA_MS;
  if (d <= 1 && avisoEnviado < 2) return 2;
  if (d <= 7 && avisoEnviado < 1) return 1;
  return 0;
}

/** HMAC-SHA256 en hexadecimal minúscula (así firma Wompi el cuerpo del webhook). */
export async function firmaHmac(secreto: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante. */
export function iguales(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function firmaValida(secreto: string, cuerpoCrudo: string, firmaRecibida: string | null) {
  if (!secreto || !firmaRecibida) return false;
  return iguales(await firmaHmac(secreto, cuerpoCrudo), firmaRecibida.trim().toLowerCase());
}

export type EventoWompi = { idTransaccion: string; pagoId: string; monto: number; resultado: string; esProductiva: boolean | null };
/** Lee el cuerpo del webhook (claves en PascalCase según la documentación); devuelve null si no tiene lo mínimo. */
export function leerEvento(o: unknown): EventoWompi | null {
  const e = o as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return null;
  const enlace = (e.EnlacePago ?? e.enlacePago) as Record<string, unknown> | undefined;
  const idTransaccion = String(e.IdTransaccion ?? e.idTransaccion ?? "");
  const pagoId = String(enlace?.IdentificadorEnlaceComercio ?? enlace?.identificadorEnlaceComercio ?? "");
  if (!idTransaccion || !pagoId) return null;
  return {
    idTransaccion, pagoId, monto: Number(e.Monto ?? e.monto ?? NaN), resultado: String(e.ResultadoTransaccion ?? e.resultadoTransaccion ?? ""),
    esProductiva: typeof (e.EsProductiva ?? e.esProductiva) === "boolean" ? Boolean(e.EsProductiva ?? e.esProductiva) : null
  };
}

export const montoCoincide = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
