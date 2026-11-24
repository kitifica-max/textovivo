// Panel de métricas (PWA del dueño). Habla con /admin/panel usando la clave de administrador guardada en este dispositivo.
const $ = (id) => document.getElementById(id);
const CLAVE = "tv_admin";
const COPIA = "tv_panel_ultimo";
const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (x) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("es"));
const suma = (a) => a.reduce((s, x) => s + x.n, 0);
let temporizador = null, ultimo = null, orden = "uso", filtro = "";
const previos = new Map(); // valor mostrado antes, para animar el cambio desde ahí (no desde cero)

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw-panel.js").catch(() => {});

// Solo vuelve a escribir (y animar) lo que cambió: sin esto las barras se re-animarían cada minuto.
function pintarSi(el, html) { if (el._html === html) return false; el._html = html; el.innerHTML = html; return true; }

function mostrar(tablero) { $("tablero").hidden = !tablero; $("entrada").hidden = tablero; }

/* ---------- Números que se acomodan: de lo que se veía al valor nuevo ---------- */
function contar(el, hasta, fmt = n) {
  const clave = el.dataset.k, desde = previos.get(clave) ?? 0;
  previos.set(clave, hasta);
  if (reducido || desde === hasta) { el.textContent = fmt(hasta); return; }
  const t0 = performance.now(), dur = 800;
  const paso = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4); // desacelera como un resorte sin rebote
    el.textContent = fmt(Math.round(desde + (hasta - desde) * e));
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}
const animarNumeros = (raiz) => raiz.querySelectorAll("[data-contar]").forEach((el) => contar(el, Number(el.dataset.contar), el.dataset.sufijo ? (v) => n(v) + el.dataset.sufijo : n));
const num = (k, v, sufijo = "") => `<span data-k="${k}" data-contar="${v}"${sufijo ? ` data-sufijo="${sufijo}"` : ""}>${n(v)}${sufijo}</span>`;

/* ---------- Tendencia: últimos 7 días contra los 7 anteriores ---------- */
function tendencia(serie) {
  const a = suma(serie.slice(-7)), b = suma(serie.slice(-14, -7));
  if (!a && !b) return "";
  if (!b) return `<span class="pn-tend sube">nuevo</span>`;
  const d = Math.round(((a - b) / b) * 100);
  const clase = d > 0 ? "sube" : d < 0 ? "baja" : "";
  return `<span class="pn-tend ${clase}" title="Últimos 7 días contra los 7 anteriores">${d > 0 ? "▲" : d < 0 ? "▼" : "•"} ${Math.abs(d)}%</span>`;
}
function chispa(serie, color) {
  const v = serie.slice(-14).map((x) => x.n), max = Math.max(1, ...v), w = 100, h = 40;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 4 - (y / max) * (h - 8)).toFixed(1)}`);
  return `<svg class="pn-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts.join(" L")}" stroke="${color}" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------- Gráfico de barras con etiqueta al tocar o pasar el puntero ---------- */
function grafico(cont, datos, color, unidad) {
  const firma = JSON.stringify(datos); if (cont._firma === firma) return; cont._firma = firma;
  const w = 300, h = 100, an = w / datos.length, max = Math.max(1, ...datos.map((d) => d.n));
  const prom = suma(datos.slice(-7)) / 7, yProm = h - (prom / max) * (h - 6);
  const rects = datos.map((d, i) => {
    const alto = d.n ? Math.max(3, (d.n / max) * (h - 6)) : 1.5;
    return `<rect style="--i:${i}" data-i="${i}" x="${(i * an + 1).toFixed(1)}" y="${(h - alto).toFixed(1)}" width="${(an - 2).toFixed(1)}" height="${alto.toFixed(1)}" rx="2.5" fill="${color}" opacity="${d.n ? 1 : 0.22}"/>`;
  }).join("");
  const dia = (s, largo) => new Date(s + "T12:00:00").toLocaleDateString("es", largo ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
  cont.innerHTML = `<div class="pn-etiqueta" role="presentation"></div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Barras por día. ${unidad}: ${suma(datos)} en 30 días"><line class="guia" x1="0" x2="${w}" y1="${h - (h - 6) / 2}" y2="${h - (h - 6) / 2}"/>${rects}${prom > 0 ? `<line class="promedio" x1="${(w - 7 * an).toFixed(1)}" x2="${w}" y1="${yProm.toFixed(1)}" y2="${yProm.toFixed(1)}"/>` : ""}</svg>` +
    `<div class="pn-ejes"><span>${dia(datos[0].d)}</span><span>máx. ${max}</span><span>${dia(datos[datos.length - 1].d)}</span></div>` +
    (prom > 0 ? `<p class="pn-leyenda"><span><i></i>promedio de los últimos 7 días: ${prom.toFixed(1).replace(".", ",")}</span></p>` : "");
  const svg = cont.querySelector("svg"), tip = cont.querySelector(".pn-etiqueta");
  const marcar = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(datos.length - 1, Math.floor(((e.clientX - r.left) / r.width) * datos.length)));
    svg.classList.add("foco");
    svg.querySelectorAll("rect").forEach((x) => x.classList.toggle("sel", Number(x.dataset.i) === i));
    tip.textContent = `${dia(datos[i].d, true)} · ${datos[i].n} ${unidad}`;
    const x = ((i + 0.5) / datos.length) * r.width;
    tip.style.left = Math.max(60, Math.min(r.width - 60, x)) + "px";
    tip.classList.add("v");
  };
  const soltar = () => { svg.classList.remove("foco"); svg.querySelectorAll("rect.sel").forEach((x) => x.classList.remove("sel")); tip.classList.remove("v"); };
  svg.addEventListener("pointermove", marcar); svg.addEventListener("pointerdown", marcar);
  svg.addEventListener("pointerleave", soltar); svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") setTimeout(soltar, 1400); });
}

function filas(lista, vacio) {
  if (!lista.length) return `<li><p class="pn-vacio">${esc(vacio)}</p></li>`;
  const max = Math.max(...lista.map((x) => x.n));
  return lista.map((x, i) => `<li><span title="${esc(x.nombre)}">${esc(x.nombre)}</span><b>${n(x.n)}</b><div class="pn-hilo"><i style="--i:${i};width:${Math.max(3, (x.n / max) * 100)}%"></i></div></li>`).join("");
}

/* ---------- Puerta de cobro: tres anillos ---------- */
function anillo(clave, titulo, m, sufijo, faltaTxt) {
  const ok = m.valor >= m.meta, pct = Math.min(100, (m.valor / m.meta) * 100);
  const antes = previos.get("pct-" + clave) ?? 0; previos.set("pct-" + clave, pct);
  const falta = ok ? "meta cumplida" : faltaTxt(m.meta - m.valor);
  return `<div class="pn-anillo${ok ? " ok" : ""}"><div class="figura"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pista" cx="60" cy="60" r="50" pathLength="100"/><circle class="valor" cx="60" cy="60" r="50" pathLength="100" style="stroke-dashoffset:${100 - antes}" data-pct="${pct}"/></svg><div class="centro"><span>${num(clave, m.valor, sufijo)}<small>meta ${m.meta}${sufijo}</small></span></div></div><div class="etiqueta">${esc(titulo)}</div><div class="falta">${esc(falta)}</div></div>`;
}
function pintarPuerta(d) {
  const p = d.puerta, metas = Object.values(p), cumplidas = metas.filter((m) => m.valor >= m.meta).length, listo = cumplidas === metas.length;
  $("puerta").innerHTML =
    `<div class="pn-puerta-cab"><strong>${listo ? "Las tres metas se cumplen" : `${cumplidas} de 3 metas · todavía no`}</strong><span class="pn-insignia${listo ? " ok" : ""}">${listo ? "Listo para cobrar" : "Primero medir"}</span></div>` +
    `<div class="pn-anillos">` +
    anillo("m1", "Cuentas con acceso", p.cuentas_con_acceso, "", (f) => `faltan ${f}`) +
    anillo("m2", "Primera consulta en 24 h", p.activacion_24h_pct, "%", (f) => `faltan ${f} puntos`) +
    anillo("m3", "Usan 5 o más consultas", p.cinco_o_mas_pct, "%", (f) => `faltan ${f} puntos`) +
    `</div><p class="pn-puerta-pie">Cobrar solo con las tres metas en verde. Hoy: ${n(d.accesos.activos)} accesos activos y ${n(d.accesos.vencidos)} vencidos.</p>`;
  // el anillo se llena desde lo que ya mostraba (o desde vacío la primera vez)
  requestAnimationFrame(() => document.querySelectorAll(".pn-anillo .valor").forEach((c, i) => { c.style.strokeDashoffset = 100 - Number(c.dataset.pct); }));
  animarNumeros($("puerta"));
}

/* ---------- Resumen ---------- */
function pintarKpis(d) {
  const grande = (t, k, v, tend, sub, serie, color) => `<div class="pn-kpi grande"><span>${esc(t)}${tend}</span><strong>${num(k, v)}</strong><small>${esc(sub)}</small>${chispa(serie, color)}</div>`;
  const chico = (t, k, v, sub, sufijo = "") => `<div class="pn-kpi"><span>${esc(t)}</span><strong>${num(k, v, sufijo)}</strong><small>${esc(sub)}</small></div>`;
  $("kpis").innerHTML =
    grande("Consultas (7 días)", "k-consultas", d.uso.consultas_7d, tendencia(d.uso.por_dia), `${n(d.uso.consultas_hoy)} en las últimas 24 h`, d.uso.por_dia, "var(--rojo)") +
    grande("Cuentas nuevas (7 días)", "k-nuevas", d.cuentas.nuevas_7d, tendencia(d.cuentas.por_dia), `${n(d.cuentas.nuevas_30d)} en 30 días`, d.cuentas.por_dia, "var(--azul)") +
    chico("Cuentas", "k-cuentas", d.cuentas.total, `${n(d.cuentas.verificadas)} con email confirmado`) +
    chico("Activos (7 días)", "k-activos", d.uso.usuarios_activos_7d, `${n(d.uso.usuarios_activos_30d)} en 30 días`) +
    chico("Hicieron una consulta", "k-activ", d.accesos.activacion_pct, `${n(d.accesos.con_primera_consulta)} de ${n(d.puerta.cuentas_con_acceso.valor)} accesos`, "%") +
    chico("Por vencer (7 días)", "k-vencer", d.accesos.por_vencer_7d, "accesos que vencen pronto");
  animarNumeros($("kpis"));
}

/* ---------- Biblioteca: buscar y ordenar ---------- */
function pintarLibros() {
  if (!ultimo) return;
  const b = ultimo.biblioteca;
  const q = filtro.trim().toLowerCase();
  let lista = b.libros.filter((l) => !q || (l.titulo + " " + l.autor).toLowerCase().includes(q));
  const cmp = {
    uso: (a, c) => c.consultas_30d - a.consultas_30d || c.agregados - a.agregados || a.titulo.localeCompare(c.titulo),
    nuevos: (a, c) => (c.desde || "").localeCompare(a.desde || "") || c.consultas_30d - a.consultas_30d,
    az: (a, c) => a.titulo.localeCompare(c.titulo)
  }[orden];
  lista = lista.sort(cmp);
  const max = Math.max(1, ...b.libros.map((l) => l.consultas_30d));
  $("t-biblioteca").textContent = `${n(b.libros_total)} libros` + (b.libros_nuevos_14d ? ` · ${n(b.libros_nuevos_14d)} nuevos en 14 días` : "") + (q ? ` · ${lista.length} coinciden` : "");
  $("l-libros").innerHTML = lista.length ? lista.map((l) =>
    `<li class="${l.consultas_30d ? "" : "sin-uso"}"><div class="tit"><b title="${esc(l.titulo)}">${esc(l.titulo)}${l.nuevo ? '<span class="pn-nuevo">Nuevo</span>' : ""}</b><small>${esc(l.autor)} · ${esc(l.origen)}${l.origen === "catálogo" ? ` · ${l.frameworks} frameworks · ${l.checklists} checklists` : ""}</small></div>` +
    `<div class="cifra">${n(l.consultas_30d)}<small>consultas</small></div><div class="cifra">${n(l.agregados)}<small>agregado${l.agregados === 1 ? "" : "s"}</small></div>` +
    `<div class="barra-uso"><i style="width:${(l.consultas_30d / max) * 100}%"></i></div></li>`).join("")
    : `<li><p class="pn-vacio" style="grid-column:1/-1;padding:8px 0">Ningún libro coincide con «${esc(filtro)}».</p></li>`;
}

function pintar(d, estado) {
  ultimo = d;
  pintarPuerta(d);
  pintarKpis(d);
  grafico($("g-cuentas"), d.cuentas.por_dia, "var(--azul)", "cuentas");
  $("t-cuentas").textContent = n(d.cuentas.nuevas_30d) + " en total";
  grafico($("g-uso"), d.uso.por_dia, "var(--rojo)", "consultas");
  $("t-uso").textContent = n(suma(d.uso.por_dia)) + " en total";
  pintarSi($("l-herramientas"), filas(d.uso.por_herramienta, "Todavía no hay consultas."));
  pintarSi($("l-consultados"), filas(d.uso.libros_mas_consultados, "Todavía no hay consultas por libro."));
  pintarSi($("l-agregados"), filas(d.biblioteca.libros_mas_agregados, "Nadie agregó libros todavía."));
  const lat = (v) => (v === null ? "—" : v + " ms");
  $("l-servicio").innerHTML =
    `<li><span>Latencia media</span><b>${lat(d.uso.latencia_media_ms)}</b></li><li><span>Latencia p95</span><b>${lat(d.uso.latencia_p95_ms)}</b></li>` +
    `<li><span>Libros en la biblioteca</span><b>${n(d.biblioteca.libros_total)}</b></li><li><span>Consultas desde siempre</span><b>${n(d.uso.consultas_total)}</b></li>` +
    `<li><span>Envíos por revisar</span><b>${n(d.envios.pendientes)}</b></li>` + (d.envios.pendientes ? `<li><a class="enlace" href="/revision.html">Ir a revisión →</a></li>` : "");
  pintarLibros();
  const hora = new Date(d.generado).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  estadoVivo(estado === "cache" ? "sin" : "ok", estado === "cache" ? `Sin conexión · datos de las ${hora}` : `Actualizado ${hora}`);
}

function estadoVivo(clase, texto) { const e = $("estado"); e.className = "pn-vivo " + (clase === "ok" ? "" : clase); $("estado-txt").textContent = texto; }

async function cargar() {
  const clave = localStorage.getItem(CLAVE);
  if (!clave) return mostrar(false);
  $("actualizar").classList.add("gira"); $("actualizar").disabled = true;
  if (ultimo) estadoVivo("carga", "Actualizando…");
  try {
    const r = await fetch("/admin/panel", { headers: { authorization: "Bearer " + clave }, cache: "no-store" });
    if (r.status === 401) { localStorage.removeItem(CLAVE); mostrar(false); const e = $("error"); e.textContent = "Clave incorrecta."; e.hidden = false; return; }
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    localStorage.setItem(COPIA, JSON.stringify(d));
    mostrar(true); pintar(d, "red");
  } catch {
    const copia = localStorage.getItem(COPIA);
    if (copia) { mostrar(true); pintar(JSON.parse(copia), "cache"); } else { mostrar(false); const e = $("error"); e.textContent = "No se pudo conectar. Probá de nuevo."; e.hidden = false; }
  } finally { $("actualizar").classList.remove("gira"); $("actualizar").disabled = false; }
}

/* ---------- Eventos ---------- */
$("form-entrada").addEventListener("submit", (ev) => { ev.preventDefault(); $("error").hidden = true; localStorage.setItem(CLAVE, $("clave").value.trim()); $("clave").value = ""; cargar(); });
$("actualizar").addEventListener("click", cargar);
$("salir").addEventListener("click", () => { localStorage.removeItem(CLAVE); localStorage.removeItem(COPIA); clearInterval(temporizador); previos.clear(); ultimo = null; mostrar(false); });
$("buscar").addEventListener("input", (e) => { filtro = e.target.value; pintarLibros(); });
document.querySelectorAll("[data-orden]").forEach((b) => b.addEventListener("click", () => { orden = b.dataset.orden; document.querySelectorAll("[data-orden]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); pintarLibros(); }));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && localStorage.getItem(CLAVE)) cargar(); });
temporizador = setInterval(() => { if (document.visibilityState === "visible" && localStorage.getItem(CLAVE)) cargar(); }, 60000);

// Barra de secciones: marca la que se está viendo
const enlaces = [...document.querySelectorAll(".pn-nav a")];
const visto = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) enlaces.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + e.target.id))); }); }, { rootMargin: "-30% 0px -60% 0px" });
document.querySelectorAll(".pn section[id]").forEach((s) => visto.observe(s));

// Primer pintado inmediato con la última copia (si hay) y después se refresca desde la red
(() => {
  const copia = localStorage.getItem(COPIA);
  if (localStorage.getItem(CLAVE) && copia) { try { mostrar(true); pintar(JSON.parse(copia), "red"); estadoVivo("carga", "Actualizando…"); } catch {} }
  cargar();
})();
