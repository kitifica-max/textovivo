// Genera, desde data/catalogo.json y scripts/sitio.json:
//   - los pósters de ../diseno/biblioteca.html (entre <!--libros--> y <!--/libros-->)
//   - una ficha por libro disponible en ../diseno/libros/<id>.html
// El libro 001 también sale de acá; texto.html solo redirige a su ficha.
// Uso: node scripts/sitio.ts   (después de node scripts/catalogo.ts)
import { mkdir, readFile, writeFile } from "node:fs/promises";

type Ficha = {
  num: string; id: string | null; color: string; plegado: boolean; tema: string;
  titulo_clase: string; titulo_estilo: string; titulo: string; autor: string;
};
const fichas: Ficha[] = JSON.parse(await readFile("scripts/sitio.json", "utf8"));
type Paso = { titulo: string; descripcion: string; pagina: number; cita: string };
type Item = { texto: string; pagina: number; cita: string };
type Libro = {
  id: string; titulo: string; autor: string; descripcion: string; idioma: string;
  indice: { titulo: string; pagina_inicio: number }[];
  glosario: { termino: string; definicion: string; pagina: number }[];
  frameworks: { nombre: string; resumen: string; pasos: Paso[] }[];
  checklists: { nombre: string; contexto: string; items: Item[] }[];
};
const catalogo = JSON.parse(await readFile("data/catalogo.json", "utf8")) as Libro[];
const porId = new Map(catalogo.map((d) => [d.id, d]));
const TEMAS: Record<string, string> = { estrategia: "Estrategia", marketing: "Marketing", decisiones: "Decisiones", investigacion: "Investigación", negocios: "Negocios", escritura: "Escritura" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const disponible = (f: Ficha) => Boolean(f.id && porId.has(f.id));
const href = (f: Ficha) => `libros/${f.id}.html`;

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

// 1b) Libros destacados del landing (index.html, entre <!--destacados--> y <!--/destacados-->)
const DESTACADOS = ["arte-de-la-guerra", "principe", "scientific-advertising", "babylon", "meditaciones", "gracian", "estilo", "propaganda"];
const elegidos = DESTACADOS.map((id) => fichas.find((f) => f.id === id)).filter((f): f is Ficha => Boolean(f) && disponible(f!));
const total = fichas.filter(disponible).length;
const bloque = `
      <div class="cabeza">
        <div><p class="micro">Ya en la biblioteca</p><h2 style="margin-top:10px">Los libros más importantes.</h2></div>
        <p class="bajada" style="max-width:26em">Clásicos de estrategia, negocios, decisiones y escritura, listos para que tu IA los consulte.</p>
      </div>
      <div class="grilla cuatro">
${elegidos.map(poster).join("")}      </div>
      <div class="acciones" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:32px">
        <a class="boton" href="biblioteca.html">Ver la biblioteca completa · ${total} libros</a>
        <a class="boton claro" href="entrar.html">Obtener acceso gratis</a>
      </div>
      `;
let inicio = await readFile("../diseno/index.html", "utf8");
inicio = inicio.replace(/<!--destacados-->[\s\S]*<!--\/destacados-->/, `<!--destacados-->${bloque}<!--/destacados-->`);
await writeFile("../diseno/index.html", inicio);

// 2) Una ficha por libro, con las mismas secciones que texto.html (la del libro 001, hecha a mano):
//    datos, frameworks, checklists, «¿Qué cambia cuando tu IA tiene el libro?» e índice.
//    Todo sale de data/catalogo.json: nada se escribe a mano por libro.
const IDIOMA: Record<string, string> = { en: "inglés", es: "español" };
const COLORES = ["c-azul", "c-naranja", "c-hueso plegado", "c-menta", "c-salmon", "c-cuadricula", "c-celeste", "c-manteca", "c-rojo", "c-acero", "c-blanco", "c-bosque"];
const CLASES = ["t-alta", "t-grotesca", "t-cursiva", "t-grotesca", "t-negra", "t-serif", "t-angosta", "t-grotesca", "t-angosta", "t-alta", "t-grotesca", "t-negra"];
const NUMEROS = ["Cero", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez", "Once", "Doce"];
const cantidad = (n: number, singular: string, plural: string) => `${n <= 12 ? NUMEROS[n] : n} ${n === 1 ? singular : plural}`.replace(/^Un (framework|checklist)s?$/, (_, p) => `Un ${p}`);
const corto = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const tamano = (s: string) => (s.length > 34 ? "font-size:8.5cqi" : s.length > 24 ? "font-size:10.5cqi" : s.length > 16 ? "font-size:12.5cqi" : "");

const tarjetas = (items: { nombre: string; detalle: string }[]) =>
  items
    .map((x, i) => {
      const e = tamano(x.nombre);
      return `        <article class="poster ${COLORES[i % COLORES.length]}"><span class="num">${String(i + 1).padStart(2, "0")}</span><h3 class="titulo ${CLASES[i % CLASES.length]}"${e ? ` style="${e}"` : ""}>${esc(x.nombre)}</h3><p class="texto mono">${esc(x.detalle)}</p></article>`;
    })
    .join("\n");

function ejemplo(d: Libro) {
  const ck = d.checklists[0];
  const fw = d.frameworks[0];
  const base = ck ?? fw;
  if (!base) return "";
  const puntos = ck ? ck.items.map((i) => ({ texto: i.texto, pagina: i.pagina })) : fw.pasos.map((p) => ({ texto: `${p.titulo}: ${p.descripcion}`, pagina: p.pagina }));
  const [a, b] = puntos;
  const pregunta = `Revisá mi trabajo con «${base.nombre}» de ${d.autor}.`;
  const resp = `Revisemos «${base.nombre}». ${corto(a.texto, 140)}${b ? ` Después: ${corto(b.texto, 120)}` : ""}`;
  return `
  <section class="seccion" style="padding-top:0">
    <div class="envoltura">
      <div class="cabeza">
        <div><p class="micro">Ejemplo ilustrativo · la misma pregunta, dos veces</p><h2 style="margin-top:10px">¿Qué cambia cuando tu IA tiene el libro?</h2></div>
      </div>
      <div class="comparacion">
        <div class="sin">
          <span class="micro etiqueta">Sin Textifika</span>
          <div class="terminal">
            <div class="barra"><i></i><i></i><i></i><span>claude</span></div>
            <div class="cuerpo">
              <p class="persona">${esc(pregunta)}</p>
              <p class="respuesta">${esc(d.autor)} habla de varias ideas sobre este tema. Podrías aplicarlas siendo claro con tus objetivos…</p>
              <p class="tenue">— sin fuente, sin página</p>
            </div>
          </div>
        </div>
        <div>
          <span class="micro etiqueta" style="color:#c8231a">Con Textifika</span>
          <div class="terminal">
            <div class="barra"><i></i><i></i><i></i><span>claude · Textifika</span></div>
            <div class="cuerpo">
              <p class="persona">${esc(pregunta)}</p>
              <p class="herramienta">${ck ? "obtener_checklist" : "obtener_framework"} <span class="tenue">("${esc(base.nombre.toLowerCase())}")</span></p>
              <p class="respuesta">${esc(resp)}</p>
              <span class="chip">${esc(corto(d.titulo, 38))} · p. ${a.pagina}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

await mkdir("../diseno/libros", { recursive: true });
let n = 0;
for (const f of fichas) {
  const d = f.id ? porId.get(f.id) : undefined;
  if (!d) continue;
  const titulo = f.titulo.replace(/<[^>]+>/g, "");
  const citas = d.glosario.length + d.frameworks.reduce((t, x) => t + x.pasos.length, 0) + d.checklists.reduce((t, x) => t + x.items.length, 0);

  const secFrameworks = d.frameworks.length
    ? `
  <section class="seccion">
    <div class="envoltura">
      <div class="cabeza">
        <div><p class="micro">Lo que tu IA va a poder usar</p><h2 style="margin-top:10px">${cantidad(d.frameworks.length, "framework", "frameworks")}.</h2></div>
        <p class="bajada" style="max-width:26em">Metodologías paso a paso. Cada paso trae su cita literal y su página.</p>
      </div>
      <div class="grilla cuatro">
${tarjetas(d.frameworks.map((x) => ({ nombre: x.nombre, detalle: `${x.pasos.length} pasos · p. ${x.pasos[0].pagina}` })))}
      </div>
    </div>
  </section>`
    : "";
  const secChecklists = d.checklists.length
    ? `
  <section class="seccion" style="padding-top:${d.frameworks.length ? "0" : "clamp(40px,6vw,80px)"}">
    <div class="envoltura">
      <div class="cabeza">
        <div><p class="micro">Para revisar tu trabajo</p><h2 style="margin-top:10px">${cantidad(d.checklists.length, "checklist", "checklists")}.</h2></div>
        <p class="bajada" style="max-width:26em">Listas para que tu IA revise un plan, un texto o una decisión con el criterio del libro.</p>
      </div>
      <div class="grilla cuatro">
${tarjetas(d.checklists.map((x) => ({ nombre: x.nombre, detalle: `${x.items.length} puntos · p. ${x.items[0].pagina}` })))}
      </div>
    </div>
  </section>`
    : "";
  const secGlosario = d.glosario.length
    ? `
  <section class="seccion" style="padding-top:0">
    <div class="envoltura indice">
      <div class="cabeza"><div><p class="micro">Glosario</p><h2 style="margin-top:10px">${cantidad(d.glosario.length, "término", "términos")}.</h2></div></div>
      <ol class="lista">
${d.glosario.map((g, i) => `        <li><span class="n">${String(i + 1).padStart(2, "0")}</span><span><strong>${esc(g.termino)}</strong> · ${esc(g.definicion)}</span><span class="der">p. ${g.pagina}</span></li>`).join("\n")}
      </ol>
    </div>
  </section>`
    : "";
  const secIndice = `
  <section class="seccion" style="padding-top:0">
    <div class="envoltura indice">
      <div class="cabeza"><div><p class="micro">Índice</p><h2 style="margin-top:10px">${d.indice.length === 1 ? "Texto completo." : `${cantidad(d.indice.length, "sección", "secciones")}.`}</h2></div></div>
      <ol class="lista">
${d.indice.map((s, i) => `        <li><span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(corto(s.titulo, 90))}<span class="der">p. ${s.pagina_inicio}</span></li>`).join("\n")}
      </ol>
      <p class="nota" style="margin-top:28px;max-width:44em">Obra de dominio público, en su idioma original (${IDIOMA[d.idioma] ?? d.idioma}). Texto tomado de Project Gutenberg, Wikisource o archive.org. Las páginas son secciones lógicas del texto digital, no las de una edición impresa. Los resúmenes en español son de Textifika; las citas son literales.</p>
    </div>
  </section>`;

  const resumenMeta = `${titulo}, de ${d.autor}. ${d.descripcion} Consultalo desde tu IA con citas literales.`.slice(0, 300);
  const pagina = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#f3f0e8">
<title>${esc(titulo)} — Textifika</title>
<meta name="description" content="${esc(resumenMeta)}">
<link rel="canonical" href="https://textifika.kitifica.com/libros/${f.id}">
<meta property="og:site_name" content="Textifika">
<meta property="og:type" content="book">
<meta property="og:title" content="${esc(titulo)} — Textifika">
<meta property="og:description" content="${esc(resumenMeta)}">
<meta property="og:url" content="https://textifika.kitifica.com/libros/${f.id}">
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
  .precio .nota { flex-basis: 100%; margin: 0; }
  @media (max-width: 820px) { .ficha .envoltura { grid-template-columns: 1fr; } .ficha .poster { max-width: 360px; } }
  .comparacion { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .comparacion .terminal { height: 100%; }
  .comparacion .etiqueta { display: block; margin-bottom: 10px; }
  .comparacion .sin .respuesta { color: #8c897f; }
  @media (max-width: 760px) { .comparacion { grid-template-columns: 1fr; } }
  .indice { max-width: 860px; }
</style>
</head>
<body>
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
  <div class="envoltura">
    <a class="marca" href="../index.html" aria-label="Textifika, inicio"><svg class="iso" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--tile)"/><rect x="13" y="14" width="38" height="11" rx="3.5" fill="var(--barra)"/><path d="M26 25h12v26l-6-5.5L26 51z" fill="var(--cinta)"/></svg><span>Text<b>ifika</b></span></a>
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
          <div><strong>${citas}</strong>citas verificadas</div>
        </div>
        <div class="tarjeta precio" data-agregar="${f.id}">
          <div class="monto">Gratis<small>30 días · sin tarjeta · busca en el texto completo</small></div>
          <a class="boton" href="../entrar.html?next=libros/${f.id}.html" data-accion>Obtener acceso gratis</a>
          <p class="nota" data-pie>¿Ya tenés cuenta? <a class="enlace" href="../entrar.html?next=libros/${f.id}.html">Entrar</a></p>
          <p class="nota" data-msg role="status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  </section>
${secFrameworks}${secChecklists}${ejemplo(d)}${secGlosario}${secIndice}
</main>
<footer class="pie-sitio">
  <div class="envoltura pie-grid">
    <div class="pie-marca">
      <a class="marca" href="/index.html" aria-label="Textifika, inicio"><svg class="iso" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--tile)"/><rect x="13" y="14" width="38" height="11" rx="3.5" fill="var(--barra)"/><path d="M26 25h12v26l-6-5.5L26 51z" fill="var(--cinta)"/></svg><span>Text<b>ifika</b></span></a>
      <p>Lo mejor de cada libro, dentro de tu IA.</p>
    </div>
    <nav class="pie-col" aria-labelledby="pie-t1">
      <h2 id="pie-t1">Textifika</h2>
      <a href="/biblioteca.html">Biblioteca</a>
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
</footer>
<script src="../app.js"></script>
</body>
</html>
`;
  await writeFile(`../diseno/libros/${f.id}.html`, pagina);
  n++;
}
// Mapa del sitio: páginas públicas + una ficha por libro disponible.
const BASE = "https://textifika.kitifica.com";
const urls = ["/", "/biblioteca", "/guia", "/autores", "/terminos", "/privacidad", ...fichas.filter(disponible).map((f) => `/libros/${f.id}`)];
await writeFile("../diseno/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${BASE}${u}</loc></url>\n`).join("")}</urlset>\n`);
console.log(`biblioteca: ${fichas.filter(disponible).length} disponibles de ${fichas.length}; fichas nuevas: ${n}`);
