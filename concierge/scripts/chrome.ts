// Cabecera y pie ÚNICOS del sitio: una sola fuente para todas las páginas.
//   node scripts/chrome.ts          reescribe la navegación y el pie de cada página de diseno/
// sitio.ts importa estas mismas piezas para las fichas de libros. Las páginas de pago (pago/index.html, pagar.html),
// el panel del dueño, la puerta de entrada y el visor de texto llevan una cabecera propia a propósito.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Enlace de la sección actual: queda marcado con aria-current. */
export const navPrincipal = (actual = "") => {
  const a = (href: string, texto: string, clase = "") =>
    `<a${clase ? ` class="${clase}"` : ""} href="${href}"${href === actual ? ' aria-current="page"' : ""}>${texto}</a>`;
  return `<nav class="navegacion" aria-label="Principal">
      ${a("/biblioteca.html", "Biblioteca")}
      ${a("/planes.html", "Planes")}
      ${a("/subir.html", "Subir")}
      ${a("/#usos", "Para qué sirve", "ocultable")}
      ${a("/#guia", "Cómo funciona", "ocultable")}
      ${a("/autores.html", "Para autores", "ocultable")}
      ${a("/entrar.html", "Entrar", "boton chico")}
    </nav>`;
};

export const pie = `<footer class="pie-sitio">
  <div class="envoltura pie-grid">
    <div class="pie-marca">
      <a class="marca" href="/index.html" aria-label="Textifika, inicio"><svg class="iso" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--tile)"/><rect x="13" y="14" width="38" height="11" rx="3.5" fill="var(--barra)"/><path d="M26 25h12v26l-6-5.5L26 51z" fill="var(--cinta)"/></svg><span>Text<b>ifika</b></span></a>
      <p>Lo mejor de cada libro, dentro de tu IA.</p>
    </div>
    <nav class="pie-col" aria-labelledby="pie-t1">
      <h2 id="pie-t1">Textifika</h2>
      <a href="/biblioteca.html">Biblioteca</a>
      <a href="/planes.html">Planes</a>
      <a href="/subir.html">Subir una obra</a>
      <a href="/guia.html">Guía de conexión</a>
      <a href="/autores.html">Para autores</a>
      <a href="/mi-biblioteca.html">Mi biblioteca</a>
    </nav>
    <nav class="pie-col" aria-labelledby="pie-t2">
      <h2 id="pie-t2">Legal</h2>
      <a href="/terminos.html">Términos</a>
      <a href="/privacidad.html">Privacidad</a>
    </nav>
    <div class="pie-credito">
      <span class="pie-etiqueta">Una creación de</span>
      <a class="pie-kitifica" href="https://www.kitifica.com" target="_blank" rel="noopener" aria-label="Kitifica (se abre en una pestaña nueva)">
        <picture><source media="(prefers-color-scheme: dark)" srcset="/kitifica-claro.svg"><img src="/kitifica.svg" alt="Kitifica" width="98" height="26"></picture>
        <svg class="pie-salida" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>
      </a>
    </div>
  </div>
  <div class="envoltura pie-base"><span>© 2026 Textifika — Edición uno · El Salvador</span></div>
</footer>`;

/** Qué enlace del menú corresponde a cada página. */
export const actualDe = (ruta: string) =>
  ruta === "biblioteca.html" || ruta.startsWith("libros/") ? "/biblioteca.html"
  : ["planes.html", "subir.html", "autores.html"].includes(ruta) ? "/" + ruta
  : "";

const PROPIAS = new Set(["pagar.html", "pago/index.html", "entrar.html", "panel.html", "texto.html"]);

async function html(dir: string, base = ""): Promise<string[]> {
  const fuera: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const ruta = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) fuera.push(...(await html(join(dir, e.name), ruta)));
    else if (e.name.endsWith(".html")) fuera.push(ruta);
  }
  return fuera;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const ruta of await html("../diseno")) {
    if (PROPIAS.has(ruta)) continue;
    const ruta_abs = `../diseno/${ruta}`;
    let s = await readFile(ruta_abs, "utf8");
    if (!s.includes('<header class="cabecera">')) continue;
    const antes = s;
    s = s.replace(/<nav class="navegacion"[^>]*>[\s\S]*?<\/nav>/, () => navPrincipal(actualDe(ruta)));
    s = s.replace(/(<header class="cabecera">[\s\S]*?<a class="marca" href=")[^"]*(")/, "$1/index.html$2");
    if (/<footer class="pie-sitio">/.test(s)) s = s.replace(/<footer class="pie-sitio">[\s\S]*?<\/footer>/, () => pie);
    else if (/<script src="[^"]*app\.js"><\/script>/.test(s)) s = s.replace(/(<script src="[^"]*app\.js"><\/script>)/, (m) => `${pie}\n${m}`);
    else s = s.replace("</body>", `${pie}\n</body>`);
    if (s !== antes) { await writeFile(ruta_abs, s); n++; }
  }
  console.log(`cabecera y pie unificados en ${n} páginas`);
}
