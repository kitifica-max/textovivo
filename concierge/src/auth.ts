// Cuentas y sesiones. Contraseñas con PBKDF2-SHA256 (WebCrypto); la sesión es una cookie HttpOnly
// cuyo valor no se guarda: en D1 solo queda su sha256.
import { env } from "cloudflare:workers";

export const TERMINOS_VERSION = "2026-11-24";
const ITERACIONES = 100_000; // tope que permite Workers para PBKDF2
const SESION_DIAS = 30;
const COOKIE = "tv_sesion";
const enc = new TextEncoder();

const aB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const aleatorio = (bytes = 32) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function derivar(clave: string, sal: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: ITERACIONES }, base, 256));
}

export async function hashClave(clave: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return { hash: aB64(await derivar(clave, sal)), sal: aB64(sal) };
}

export async function claveCorrecta(clave: string, hash: string, sal: string) {
  const a = await derivar(clave, deB64(sal));
  const b = deB64(hash);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

export type Usuario = { id: string; email: string; nombre: string };

export async function abrirSesion(userId: string) {
  const token = aleatorio(32);
  const ahora = new Date();
  const vence = new Date(ahora.getTime() + SESION_DIAS * 86_400_000);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, ahora.toISOString(), vence.toISOString())
    .run();
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESION_DIAS * 86_400}`;
}

export const cookieVacia = `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

const leerCookie = (req: Request) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";

export async function usuarioActual(req: Request): Promise<Usuario | null> {
  const token = leerCookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.nombre FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<Usuario>();
}

export async function cerrarSesion(req: Request) {
  const token = leerCookie(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
