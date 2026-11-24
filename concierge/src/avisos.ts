// Aviso por correo antes de que venza el plan Pro (tarea programada diaria). Un aviso a los 7 días y otro al último día.
import { env } from "cloudflare:workers";
import { correoVencePronto, enviarCorreo } from "./correo.ts";
import { avisoPendiente, diasRestantes } from "./plan.ts";

export async function avisarVencimientos() {
  const ahora = new Date().toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id, email, nombre, plan_vence_at, plan_aviso FROM users WHERE plan != 'gratis' AND plan_vence_at IS NOT NULL AND plan_vence_at > ? AND email_verificado_at IS NOT NULL"
  ).bind(ahora).all<{ id: string; email: string; nombre: string; plan_vence_at: string; plan_aviso: number }>();
  let enviados = 0;
  for (const u of results) {
    const toca = avisoPendiente(u.plan_vence_at, u.plan_aviso, ahora);
    if (!toca) continue;
    const m = correoVencePronto(u.nombre, diasRestantes(u.plan_vence_at, ahora) ?? 1, `${env.SITIO_URL}/mi-biblioteca.html`);
    if (await enviarCorreo(u.email, m.asunto, m.html, m.texto)) {
      await env.DB.prepare("UPDATE users SET plan_aviso = ? WHERE id = ?").bind(toca, u.id).run();
      enviados++;
    }
  }
  return enviados;
}
