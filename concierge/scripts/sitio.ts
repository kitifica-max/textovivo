// Genera, desde data/catalogo.json y scripts/sitio.json:
//   - los pósters de ../diseno/biblioteca.html (entre <!--libros--> y <!--/libros-->)
//   - una ficha por libro disponible en ../diseno/libros/<id>.html
// El libro 001 conserva su ficha diseñada a mano (texto.html).
// Uso: node scripts/sitio.ts   (después de node scripts/catalogo.ts)
import { mkdir, readFile, writeFile } from "node:fs/promises";

type Ficha = {
  num: string; id: string | null; color: string; plegado: boolean; tema: string;
  titulo_clase: string; titulo_estilo: string; titulo: string; autor: string;
};
const fichas: Ficha[] = JSON.parse(await readFile("scripts/sitio.json", "utf8"));
const catalogo = JSON.parse(await readFile("data/catalogo.json", "utf8")) as {
  id: string; titulo: string; autor: string; descripcion: string; idioma: string;
  indice: { titulo: string }[]; glosario: unknown[];
  frameworks: { nombre: string; pasos: unknown[] }[]; checklists: { nombre: string; items: unknown[] }[];
};
const porId = new Map(catalogo.map((d) => [d.id, d]));
const TEMAS: Record<string, string> = { estrategia: "Estrategia", marketing: "Marketing", decisiones: "Decisiones", investigacion: "Investigación", negocios: "Negocios", escritura: "Escritura" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const disponible = (f: Ficha) => Boolean(f.id && porId.has(f.id));
const href = (f: Ficha) => (f.id === "arte-de-la-guerra" ? "texto.html" : `libros/${f.id}.html`);

// 1) Pósters de la biblioteca
const poster = (f: Ficha, i: number) => {
  const estilo = f.titulo_estilo ? ` style="${f.titulo_estilo}"` : "";
  const cuerpo = `
        <span class="num">${f.num}</span>
        <h2 class="titulo ${f.titulo_clase}"${estilo}>${f.titulo}</h2>
        <div class="pie"><span class="autor">${f.autor}</span><span class="estado${disponible(f) ? " vivo" : ""}">${disponible(f) ? "Disponible" : "Próximamente"}</span></div>
      `;
  const clases = `poster ${f.color}${f.plegado ? " plegado" : ""}`;
  const atr = `data-tema="${f.tema}" data-aparece style="--i:${3 + (i % 8)}"`;
  return disponible(f)
    ? `      <a class="${clases}" href="${href(f)}" ${atr}>${cuerpo}</a>\n`
    : `      <article class="${clases}" ${atr}>${cuerpo}</article>\n`;
};
let biblioteca = await readFile("../diseno/biblioteca.html", "utf8");
biblioteca = biblioteca.replace(/<!--libros-->[\s\S]*<!--\/libros-->/, `<!--libros-->\n${fichas.map(poster).join("")}      <!--/libros-->`);
await writeFile("../diseno/biblioteca.html", biblioteca);

// 2) Una ficha por libro
const IDIOMA: Record<string, string> = { en: "inglés", es: "español" };
const lista = (items: string[]) => (items.length ? `<ul class="nota" style="columns:2;gap:32px;line-height:1.8">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "");
await mkdir("../diseno/libros", { recursive: true });
let n = 0;
for (const f of fichas) {
  const d = f.id && porId.get(f.id);
  if (!d || f.id === "arte-de-la-guerra") continue;
  const titulo = f.titulo.replace(/<[^>]+>/g, "");
  const grandes = d.indice.length > 1 ? d.indice.map((s) => s.titulo) : [];
  const herramientas = [...d.frameworks.map((x) => `Framework: ${x.nombre}`), ...d.checklists.map((x) => `Checklist: ${x.nombre}`)];
  const pagina = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} — TextoVivo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="../estilos.css">
<style>
  .ficha { padding: clamp(32px, 5vw, 64px) 0 0; }
  .ficha .envoltura { display: grid; grid-template-columns: minmax(260px, 420px) 1fr; gap: clamp(28px, 5vw, 72px); align-items: start; }
  .ficha .poster .titulo { margin-top: 28%; }
  .ficha h1 { font-size: clamp(2.4rem, 5vw, 4.6rem); margin: 12px 0 14px; }
  .datos { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 26px 0; }
  .datos div { font-size: 0.8rem; color: var(--gris); }
  .datos strong { display: block; font: 800 2rem/1 var(--sans); letter-spacing: -0.04em; color: var(--tinta); margin-bottom: 4px; }
  .precio { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
  .precio .monto { font: 800 2.6rem/1 var(--sans); letter-spacing: -0.045em; }
  .precio .monto small { display: block; font: 500 0.8rem/1.4 var(--sans); letter-spacing: 0; color: var(--gris); margin-top: 6px; }
  @media (max-width: 820px) { .ficha .envoltura { grid-template-columns: 1fr; } .ficha .poster { max-width: 360px; } }
</style>
</head>
<body>
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
  <div class="envoltura">
    <a class="marca" href="../index.html" aria-label="TextoVivo, inicio">Texto<b>Vivo</b></a>
    <nav class="navegacion" aria-label="Principal">
      <a href="../biblioteca.html" aria-current="page">Biblioteca</a>
      <a class="ocultable" href="../index.html#guia">Cómo funciona</a>
      <a class="ocultable" href="../autores.html">Para autores</a>
      <a class="boton chico" href="../entrar.html">Entrar</a>
    </nav>
  </div>
</header>
<main id="contenido">
  <section class="ficha">
    <div class="envoltura">
      <div class="poster ${f.color}${f.plegado ? " plegado" : ""}" aria-hidden="true">
        <span class="num">${f.num}</span>
        <span class="titulo ${f.titulo_clase}"${f.titulo_estilo ? ` style="${f.titulo_estilo}"` : ""}>${f.titulo}</span>
        <span class="pie"><span class="texto fuerte">${f.autor}</span></span>
      </div>
      <div>
        <p class="micro">VT·${f.num} · ${TEMAS[f.tema] ?? f.tema} · Texto en ${IDIOMA[d.idioma] ?? d.idioma}</p>
        <h1>${f.titulo}</h1>
        <p class="bajada">${esc(d.descripcion)} Pedile a tu IA que busque en el libro y te diga la página.</p>
        <div class="datos">
          <div><strong>${d.indice.length}</strong>${d.indice.length === 1 ? "sección" : "secciones"}</div>
          <div><strong>${d.frameworks.length}</strong>frameworks</div>
          <div><strong>${d.checklists.length}</strong>checklists</div>
          <div><strong>${d.glosario.length}</strong>términos</div>
        </div>
        <div class="tarjeta precio">
          <div class="monto">Gratis<small>30 días · sin tarjeta · busca en el texto completo</small></div>
          <a class="boton" href="https://vivotext-concierge.kitifica.workers.dev">Obtener acceso gratis</a>
          <p class="nota" style="flex-basis:100%;margin:0">¿Ya lo tenés? <a class="enlace" href="../mi-biblioteca.html">Ir a mi biblioteca</a></p>
        </div>
      </div>
    </div>
  </section>
${herramientas.length ? `
  <section class="seccion">
    <div class="envoltura">
      <p class="micro">Lo que tu IA va a poder usar</p>
      <h2 style="margin:10px 0 18px">Frameworks y checklists con cita literal.</h2>
      ${lista(herramientas)}
    </div>
  </section>` : ""}
${grandes.length ? `
  <section class="seccion" style="padding-top:0">
    <div class="envoltura">
      <p class="micro">Índice</p>
      <h2 style="margin:10px 0 18px">Qué hay en el libro.</h2>
      ${lista(grandes)}
    </div>
  </section>` : ""}
  <section class="seccion" style="padding-top:0">
    <div class="envoltura">
      <p class="nota" style="max-width:44em">Obra de dominio público. Texto tomado de Project Gutenberg, en su idioma original. Las páginas son secciones lógicas de la edición digital. Los resúmenes en español son de TextoVivo; las citas son literales del texto.</p>
    </div>
  </section>
</main>
<footer class="pie-sitio">
  <div class="envoltura">
    <div>
      <div class="firma"><b>TextoVivo</b><span>Lo mejor de cada libro, dentro de tu IA</span></div>
      <nav aria-label="Pie"><a href="../biblioteca.html">Biblioteca</a><a href="../guia.html">Guía de conexión</a><a href="../autores.html">Para autores</a></nav>
    </div>
    <span class="edicion">© 2026 — Edición uno · San Salvador</span>
  </div>
</footer>
<script src="../app.js"></script>
</body>
</html>
`;
  await writeFile(`../diseno/libros/${f.id}.html`, pagina);
  n++;
}
console.log(`biblioteca: ${fichas.filter(disponible).length} disponibles de ${fichas.length}; fichas nuevas: ${n}`);
