// Envío de correos con Resend (dominio kitifica.com verificado).
// RESEND_API_KEY=consola (solo en .dev.vars) imprime el correo en vez de enviarlo, para probar en local.
import { env } from "cloudflare:workers";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function enviarCorreo(a: string, asunto: string, html: string, texto: string, responderA = "hola@kitifica.com"): Promise<boolean> {
  const clave = env.RESEND_API_KEY;
  if (!clave) return false;
  if (clave === "consola") {
    console.log(`[correo] a=${a} asunto="${asunto}"\n${texto}`);
    return true;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.CORREO_REMITENTE, to: [a], subject: asunto, html, text: texto, reply_to: responderA })
  }).catch(() => null);
  if (!r?.ok) console.error(`[correo] Resend respondió ${r?.status ?? "sin respuesta"}`);
  return Boolean(r?.ok);
}

const marco = (titulo: string, cuerpo: string, boton: string, enlace: string, pie: string) => `<!doctype html>
<html lang="es"><body style="margin:0;background:#f3f0e8;font-family:Helvetica,Arial,sans-serif;color:#161616">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fbfaf7;border-radius:18px;padding:32px">
<tr><td style="font-size:26px;letter-spacing:-0.05em;line-height:1"><img src="https://textifika.kitifica.com/isotipo-96.png" width="40" height="40" alt="" style="vertical-align:middle;border:0;margin-right:10px"><span style="vertical-align:middle"><span style="font-weight:400">Text</span><span style="font-weight:800">ifika</span></span></td></tr>
<tr><td style="padding:22px 0 8px;font-size:24px;font-weight:700;line-height:1.2">${titulo}</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding-bottom:22px">${cuerpo}</td></tr>
<tr><td style="padding-bottom:22px"><a href="${enlace}" style="display:inline-block;background:#161616;color:#fff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px">${boton}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6b665c">Si el botón no funciona, copiá este enlace en tu navegador:<br><span style="word-break:break-all">${enlace}</span></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#6b665c;padding-top:16px">${pie}</td></tr>
</table></td></tr></table></body></html>`;

export function correoVerificacion(nombre: string, enlace: string) {
  return {
    asunto: "Confirmá tu email en Textifika",
    html: marco("Confirmá tu email", `Hola ${esc(nombre)}, confirmá tu email para activar tu conector y poder subir obras. El enlace vence en 24 horas.`, "Confirmar mi email", enlace, "Si no creaste una cuenta en Textifika, ignorá este correo."),
    texto: `Hola ${nombre},\n\nConfirmá tu email para activar tu conector y poder subir obras. El enlace vence en 24 horas:\n${enlace}\n\nSi no creaste una cuenta en Textifika, ignorá este correo.`
  };
}

export function correoRestablecer(nombre: string, enlace: string) {
  return {
    asunto: "Restablecé tu contraseña de Textifika",
    html: marco("Restablecé tu contraseña", `Hola ${esc(nombre)}, alguien pidió restablecer la contraseña de tu cuenta. El enlace vence en 1 hora y sirve una sola vez.`, "Elegir una contraseña nueva", enlace, "Si no fuiste vos, ignorá este correo: tu contraseña no cambia hasta que uses el enlace."),
    texto: `Hola ${nombre},\n\nAlguien pidió restablecer la contraseña de tu cuenta de Textifika. El enlace vence en 1 hora y sirve una sola vez:\n${enlace}\n\nSi no fuiste vos, ignorá este correo: tu contraseña no cambia hasta que uses el enlace.`
  };
}

export function correoVencePronto(nombre: string, dias: number, enlace: string) {
  const cuando = dias <= 1 ? "mañana" : `en ${dias} días`;
  return {
    asunto: dias <= 1 ? "Tu plan Pro de Textifika vence mañana" : `Tu plan Pro de Textifika vence en ${dias} días`,
    html: marco(`Tu plan Pro vence ${cuando}`, `Hola ${esc(nombre)}, tu plan Pro vence ${cuando}. Después de esa fecha no podrás subir ni consultar tus documentos personales (siguen guardados). Renovar suma 30 días a lo que te queda, no los pierdes.`, "Renovar mi plan", enlace, "Es un pago único de 30 días, no una suscripción: no te cobramos nada solos."),
    texto: `Hola ${nombre},\n\nTu plan Pro vence ${cuando}. Después no podrás subir ni consultar tus documentos personales (siguen guardados). Renovar suma 30 días a lo que te queda.\n\nRenovar: ${enlace}\n\nEs un pago único de 30 días, no una suscripción: no te cobramos nada solos.`
  };
}

export type Solicitud = { titulo: string; autor: string; enlace: string; motivo: string; email: string };

/** Aviso interno a hola@kitifica.com: alguien pide un libro. */
export function correoSolicitudLibro(d: Solicitud) {
  const fila = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#6b665c;vertical-align:top">${k}</td><td style="padding:4px 0">${esc(v) || "—"}</td></tr>`;
  return {
    asunto: `Solicitud de libro: ${d.titulo}`.replace(/[\r\n]+/g, " ").slice(0, 150),
    html: `<table style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#161616">${fila("Libro", d.titulo)}${fila("Autor", d.autor)}${fila("Enlace", d.enlace)}${fila("Motivo", d.motivo)}${fila("Contacto", d.email)}</table>`,
    texto: `Libro: ${d.titulo}\nAutor: ${d.autor || "—"}\nEnlace: ${d.enlace || "—"}\nMotivo: ${d.motivo || "—"}\nContacto: ${d.email || "—"}`
  };
}
