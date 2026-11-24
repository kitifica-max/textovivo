// Páginas del H-1: venta del Texto Vivo y guía de conexión.
import type { Libro } from "./tools.ts";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const estilos = `
:root{--bg:#fbfaf7;--fg:#1d1b16;--muted:#6b665c;--card:#fff;--line:#e6e1d6;--accent:#1f6f5c;--accent-fg:#fff;--code:#f2efe8}
@media (prefers-color-scheme:dark){:root{--bg:#14130f;--fg:#efeadf;--muted:#a49d8f;--card:#1d1b16;--line:#332f27;--accent:#5cc3a5;--accent-fg:#0d1a16;--code:#262219}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 16px 64px}
.marca{font-size:14px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
h1{font-size:clamp(28px,6vw,40px);line-height:1.15;margin:8px 0 4px}
h2{font-size:20px;margin:40px 0 12px}
.autor{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
.precio{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
.monto{font-size:28px;font-weight:700}
.boton{display:inline-block;background:var(--accent);color:var(--accent-fg);padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;border:0;font-size:16px;cursor:pointer}
.boton[aria-disabled=true]{opacity:.5;pointer-events:none}
.secundario{color:var(--accent)}
ol,ul{padding-left:22px}
li{margin:6px 0}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;background:var(--code);border-radius:8px}
code{padding:2px 6px}
pre{padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0}
.copiar{font-size:14px;padding:6px 12px;margin-top:4px}
.nota{color:var(--muted);font-size:15px}
footer{margin-top:48px;color:var(--muted);font-size:14px;border-top:1px solid var(--line);padding-top:16px}
`;

const pagina = (titulo: string, cuerpo: string, script = "") => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><style>${estilos}</style></head>
<body><main>${cuerpo}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

type Config = Pick<Env, "WOMPI_LINK_URL" | "ACCESO_GRATIS" | "VIDEO_URL" | "PRICE_USD" | "CALLS_PER_TOKEN">;

export function landing(libro: Libro, env: Config) {
  const preguntas = Math.round(Number(env.CALLS_PER_TOKEN) / 3);
  const lista = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
  const gratis = env.ACCESO_GRATIS === "1";
  const alquilar = gratis
    ? `<form method="post" action="/acceso" style="display:flex;flex-wrap:wrap;gap:8px"><input type="email" name="email" required placeholder="tu@email.com" aria-label="Tu email" style="padding:12px;border-radius:10px;border:1px solid var(--line);font-size:16px"><button class="boton" type="submit">Obtener acceso gratis</button></form>`
    : env.WOMPI_LINK_URL
    ? `<a class="boton" href="${esc(env.WOMPI_LINK_URL)}" rel="noopener">Alquilar 30 días</a>`
    : `<span class="boton" aria-disabled="true">Muy pronto</span>`;

  return pagina(
    `${libro.titulo} · TextoVivo`,
    `
<div class="marca">TextoVivo</div>
<h1>${esc(libro.titulo)}</h1>
<p class="autor">de ${esc(libro.autor)}</p>
${libro.descripcion ? `<p class="nota">${esc(libro.descripcion)}</p>` : ""}
<p>Conectá este libro a tu IA. Mientras trabajás, Claude, Claude Code o Cursor consultan sus frameworks, checklists y citas con la página exacta.</p>
${env.VIDEO_URL ? `<p><a class="secundario" href="${esc(env.VIDEO_URL)}" rel="noopener">▶ Ver la demo de 30 segundos</a></p>` : ""}

<div class="card precio">
  <div><div class="monto">${gratis ? "Gratis" : `US$${esc(env.PRICE_USD)}`}</div><div class="nota">30 días de acceso · hasta ~${preguntas} preguntas</div></div>
  ${alquilar}
</div>

<h2>Qué incluye</h2>
<p>${libro.frameworks.length} frameworks, ${libro.checklists.length} checklists y ${libro.glosario.length} términos de glosario, cada uno con su cita literal y la página.</p>
${lista(libro.frameworks.map((f) => `Framework: ${f.nombre}`))}
${lista(libro.checklists.map((c) => `Checklist: ${c.nombre}`))}

<h2>Cómo funciona</h2>
<ol>
  ${gratis ? "<li>Dejás tu email.</li><li>Al instante ves tu link personal. Guardalo: es tu acceso.</li>" : "<li>Pagás con tarjeta en la pantalla segura de Wompi.</li><li>Ese mismo día te llega por email tu link personal.</li>"}
  <li>Lo conectás en tu IA siguiendo la <a class="secundario" href="/guia">guía de conexión</a> (2 a 3 minutos).</li>
  <li>Trabajás como siempre: tu IA consulta el libro cuando lo necesita.</li>
</ol>
<p class="nota">Funciona con Claude (web y escritorio, también en el plan gratis), Claude Code y Cursor.</p>

<footer>Licencia personal por 30 días. No se permite compartir el link, redistribuir ni extraer el contenido.</footer>`
  );
}

export function guia(libro: Libro) {
  return pagina(
    `Conectar ${libro.titulo} a tu IA`,
    `
<div class="marca">TextoVivo · Guía de conexión</div>
<h1>Conectá «${esc(libro.titulo)}» a tu IA</h1>
<p id="sin-url" class="nota" hidden>Abrí esta guía desde el link de tu email para ver tu URL personal ya cargada.</p>

<div class="card">
  <strong>Tu URL personal</strong>
  <pre data-url>TU_URL_DE_TEXTOVIVO</pre>
  <button class="boton copiar" data-copiar="url">Copiar URL</button>
  <p class="nota">No la compartas: es tu acceso.</p>
</div>

<h2>Claude (web o app de escritorio)</h2>
<ol>
  <li>Abrí <a class="secundario" href="https://claude.ai/customize/connectors" rel="noopener">Conectores de Claude</a>.</li>
  <li>Tocá <strong>Agregar</strong> y después <strong>Agregar conector personalizado</strong>.</li>
  <li>En nombre escribí <code>TextoVivo</code> y pegá tu URL personal.</li>
  <li>Tocá <strong>Continuar</strong>. Si te pregunta cómo iniciar sesión, elegí <strong>Sin inicio de sesión</strong>.</li>
  <li>Tocá <strong>Agregar</strong>.</li>
  <li>En un chat nuevo, abrí el menú <strong>+</strong> y verificá que TextoVivo esté activado.</li>
</ol>
<p class="nota">El plan gratis de Claude permite 1 conector personalizado. En planes Team o Enterprise, el conector lo agrega el owner de la organización.</p>

<h2>Claude Code</h2>
<pre data-comando="claude">claude mcp add --transport http textovivo TU_URL_DE_TEXTOVIVO</pre>
<button class="boton copiar" data-copiar="claude">Copiar comando</button>

<h2>Cursor</h2>
<p>Agregá esto en <code>~/.cursor/mcp.json</code> (o en <code>.cursor/mcp.json</code> de tu proyecto):</p>
<pre data-comando="cursor">{ "mcpServers": { "textovivo": { "url": "TU_URL_DE_TEXTOVIVO" } } }</pre>
<button class="boton copiar" data-copiar="cursor">Copiar configuración</button>

<h2>Probalo</h2>
<p>Pedile a tu IA: <em>«Usá TextoVivo y decime qué frameworks y checklists tiene este libro.»</em> Después, pedile que revise tu trabajo con uno de ellos.</p>

<footer>¿No funciona? Respondé el email donde recibiste tu link y te ayudamos.</footer>`,
    `
const token = location.hash.slice(1);
const url = /^[a-f0-9]{32}$/.test(token) ? location.origin + "/c/" + token + "/mcp" : null;
if (url) {
  document.querySelector("[data-url]").textContent = url;
  document.querySelectorAll("[data-comando]").forEach((el) => {
    el.textContent = el.textContent.replace("TU_URL_DE_TEXTOVIVO", url);
  });
} else {
  document.getElementById("sin-url").hidden = false;
}
document.querySelectorAll("[data-copiar]").forEach((boton) => {
  boton.addEventListener("click", async () => {
    const clave = boton.dataset.copiar;
    const origen = clave === "url" ? document.querySelector("[data-url]") : document.querySelector('[data-comando="' + clave + '"]');
    await navigator.clipboard.writeText(origen.textContent);
    const antes = boton.textContent;
    boton.textContent = "Copiado ✓";
    setTimeout(() => (boton.textContent = antes), 1500);
  });
});`
  );
}
