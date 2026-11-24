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

// ---------- Token del pago con tarjeta ----------
// El formulario manda la tarjeta directo al Worker (no pasa por Netlify), así que no hay cookie de sesión:
// este token, firmado y de 15 minutos, dice «esta cuenta puede intentar pagar este pago».
const b64 = (t: string) => btoa(String.fromCharCode(...new TextEncoder().encode(t))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deb64 = (t: string) => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export async function firmarToken(secreto: string, pagoId: string, userId: string, ahoraMs = Date.now(), vigenciaMs = 15 * 60_000) {
  const cuerpo = b64(JSON.stringify({ p: pagoId, u: userId, e: ahoraMs + vigenciaMs }));
  return `${cuerpo}.${await firmaHmac(secreto, "token-pago:" + cuerpo)}`;
}

export async function leerToken(secreto: string, token: string, ahoraMs = Date.now()): Promise<{ pagoId: string; userId: string } | null> {
  const [cuerpo, firma] = String(token ?? "").split(".");
  if (!cuerpo || !firma || !secreto) return null;
  if (!iguales(await firmaHmac(secreto, "token-pago:" + cuerpo), firma)) return null;
  try {
    const t = JSON.parse(deb64(cuerpo)) as { p?: string; u?: string; e?: number };
    if (!t.p || !t.u || typeof t.e !== "number" || t.e < ahoraMs) return null;
    return { pagoId: t.p, userId: t.u };
  } catch { return null; }
}

// ---------- Validación de tarjeta (también en el servidor: el navegador no es de fiar) ----------
export const luhn = (num: string) => {
  let suma = 0, doble = false;
  for (let i = num.length - 1; i >= 0; i--) { let d = Number(num[i]); if (doble) { d *= 2; if (d > 9) d -= 9; } suma += d; doble = !doble; }
  return num.length >= 13 && suma % 10 === 0;
};
export const marcaTarjeta = (num: string): "visa" | "mastercard" | "otra" => (/^4/.test(num) ? "visa" : /^(5[1-5]|2[2-7])/.test(num) ? "mastercard" : "otra");

export type EntradaTarjeta = { numero?: unknown; cvv?: unknown; mes?: unknown; anio?: unknown; nombre?: unknown };
/** Devuelve el mensaje de error para quien paga, o null si todo está bien. */
export function validarTarjeta(e: EntradaTarjeta, ahora = new Date()): string | null {
  const numero = String(e.numero ?? "").replace(/\D/g, ""), cvv = String(e.cvv ?? "").replace(/\D/g, "");
  const mes = Number(e.mes), anio = Number(e.anio);
  if (String(e.nombre ?? "").trim().length < 2) return "Escribí tu nombre.";
  if (numero.length < 15 || numero.length > 19 || !luhn(numero)) return "El número de tarjeta no es válido.";
  if (marcaTarjeta(numero) === "otra") return "Solo aceptamos Visa y Mastercard.";
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return "El mes de vencimiento no es válido.";
  if (!Number.isInteger(anio) || anio < ahora.getFullYear() || (anio === ahora.getFullYear() && mes < ahora.getMonth() + 1)) return "La tarjeta está vencida.";
  if (cvv.length !== 3) return "El CVV debe tener 3 dígitos.";
  return null;
}

/** «Ana María Pérez» → { nombre: «Ana», apellido: «María Pérez» }; con una sola palabra, el apellido repite el nombre. */
export function separarNombre(completo: string) {
  const partes = completo.trim().split(/\s+/);
  return { nombre: partes[0] ?? "", apellido: partes.slice(1).join(" ") || partes[0] || "" };
}
