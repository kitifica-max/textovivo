// Interacciones del prototipo. Sin dependencias.

// Copiar al portapapeles: <button data-copiar="#id">
document.querySelectorAll("[data-copiar]").forEach((boton) => {
  boton.addEventListener("click", async () => {
    const origen = document.querySelector(boton.dataset.copiar);
    if (!origen) return;
    await navigator.clipboard.writeText(origen.textContent.trim());
    const antes = boton.textContent;
    boton.textContent = "Copiado";
    setTimeout(() => (boton.textContent = antes), 1600);
  });
});

// Pestañas accesibles: [role=tablist] > button[aria-controls]
document.querySelectorAll('[role="tablist"]:not([data-propio])').forEach((lista) => {
  const pestanas = [...lista.querySelectorAll('[role="tab"]')];
  const activar = (p) => {
    pestanas.forEach((x) => {
      const activa = x === p;
      x.setAttribute("aria-selected", String(activa));
      x.tabIndex = activa ? 0 : -1;
      document.getElementById(x.getAttribute("aria-controls")).hidden = !activa;
    });
  };
  pestanas.forEach((p, i) => {
    p.addEventListener("click", () => activar(p));
    p.addEventListener("keydown", (e) => {
      const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!paso) return;
      const siguiente = pestanas[(i + paso + pestanas.length) % pestanas.length];
      siguiente.focus();
      activar(siguiente);
    });
  });
});

// Filtros del catálogo: botones [data-filtro] muestran fichas [data-tema]
const filtros = document.querySelectorAll("[data-filtro]");
filtros.forEach((f) =>
  f.addEventListener("click", () => {
    filtros.forEach((x) => x.setAttribute("aria-pressed", String(x === f)));
    const tema = f.dataset.filtro;
    document.querySelectorAll("[data-tema]").forEach((ficha) => {
      ficha.hidden = tema !== "todo" && ficha.dataset.tema !== tema;
    });
  })
);

// Formularios de demostración: muestran el estado siguiente en vez de enviar
document.querySelectorAll("form[data-demo]").forEach((form) =>
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    form.hidden = true;
    const siguiente = document.getElementById(form.dataset.demo);
    siguiente.hidden = false;
    siguiente.querySelector("h2, h3, [tabindex]")?.focus();
  })
);

// Número de tarjeta en grupos de 4 (solo formato visual)
document.querySelectorAll("[data-tarjeta]").forEach((input) =>
  input.addEventListener("input", () => {
    const digitos = input.value.replace(/\D/g, "").slice(0, 19);
    input.value = digitos.replace(/(.{4})/g, "$1 ").trim();
  })
);


// Sesión: con cuenta abierta, «Entrar» pasa a ser «Mi biblioteca» y aparece «Salir» en la cabecera.
// tv_sesion_hint (solo una marca local, no es la sesión) evita el parpadeo de «Entrar» al cambiar de página.
const hayHint = localStorage.getItem("tv_sesion_hint") === "1";
function ponerSesion() {
  // Netlify reescribe «entrar.html» como «/entrar»: se compara por la ruta, con o sin .html.
  document.querySelectorAll("nav.navegacion a.boton").forEach((a) => {
    if (!/\/entrar(\.html)?$/.test(a.pathname)) return;
    a.textContent = "Mi biblioteca";
    a.setAttribute("href", a.getAttribute("href").replace(/entrar(\.html)?(?=$|[?#])/, "mi-biblioteca"));
  });
  document.querySelectorAll(".navegacion").forEach((nav) => {
    if (nav.querySelector("[data-salir]")) return;
    const salir = document.createElement("button");
    salir.type = "button"; salir.className = "salir"; salir.dataset.salir = ""; salir.textContent = "Salir";
    salir.addEventListener("click", async () => {
      salir.disabled = true;
      await fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" }).catch(() => {});
      localStorage.removeItem("tv_sesion_hint");
      location.href = location.pathname.includes("/libros/") ? "../index.html" : "index.html";
    });
    nav.append(salir);
  });
  document.querySelectorAll("[data-subir]").forEach((a) => {
    a.textContent = "Subir mi obra";
    a.setAttribute("href", "subir.html");
  });
}
if (hayHint) ponerSesion();
fetch("/api/yo", { credentials: "same-origin" })
  .then((r) => {
    if (r.ok) { localStorage.setItem("tv_sesion_hint", "1"); ponerSesion(); }
    else if (r.status === 401 && hayHint) { localStorage.removeItem("tv_sesion_hint"); location.reload(); } // la marca estaba vencida
  })
  .catch(() => {});


// Ficha de libro: «Agregar a mi biblioteca». Estados: sin sesión → entrar y volver; con sesión → agregar / ya agregado (quitar).
document.querySelectorAll("[data-agregar]").forEach(async (tarjeta) => {
  const id = tarjeta.dataset.agregar;
  const boton = tarjeta.querySelector("[data-accion]");
  const pie = tarjeta.querySelector("[data-pie]");
  const msg = tarjeta.querySelector("[data-msg]");
  const llamar = (ruta) =>
    fetch(ruta, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ libro: id }), credentials: "same-origin" })
      .then(async (r) => ({ ok: r.ok, datos: await r.json().catch(() => ({})) }))
      .catch(() => ({ ok: false, datos: {} }));
  const pintar = (agregado) => {
    const b = boton.cloneNode(false); // sin oyentes viejos
    boton.replaceWith(b);
    b.className = agregado ? "boton claro" : "boton";
    if (agregado) {
      b.textContent = "✓ En tu biblioteca";
      b.setAttribute("href", "../mi-biblioteca.html");
      pie.innerHTML = 'Ya podés pedírselo a tu IA. <a class="enlace" href="../mi-biblioteca.html">Ver mi biblioteca</a> · <button type="button" class="enlace" data-quitar>Quitar</button>';
      pie.querySelector("[data-quitar]").addEventListener("click", async () => {
        const r = await llamar("/api/mis-libros/quitar");
        if (r.ok) { msg.textContent = "Lo quitaste de tu biblioteca."; tarjeta._boton = b; pintar(false); }
        else msg.textContent = r.datos.error || "No se pudo quitar. Probá de nuevo.";
      });
    } else {
      b.textContent = "Agregar a mi biblioteca";
      b.removeAttribute("href");
      b.setAttribute("type", "button");
      pie.textContent = "Gratis · tu conector ya incluye toda la biblioteca.";
      b.addEventListener("click", agregar);
    }
    tarjeta._boton = b;
  };
  async function agregar() {
    const b = tarjeta._boton || boton;
    b.disabled = true; msg.textContent = "Agregando…";
    const r = await llamar("/api/mis-libros");
    b.disabled = false;
    if (r.ok) { msg.textContent = "Listo, se agregó a tu biblioteca."; pintar(true); }
    else msg.textContent = r.datos.error || "No se pudo agregar. Probá de nuevo.";
  }
  const sesion = await fetch("/api/yo", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!sesion) {
    boton.textContent = "Crear cuenta gratis y agregarlo";
    return;
  }
  pintar(sesion.mis_libros.includes(id));
  if (new URLSearchParams(location.search).get("agregar") === "1") {
    history.replaceState(null, "", location.pathname);
    if (!sesion.mis_libros.includes(id)) agregar();
  }
});

// Turnstile (captcha de Cloudflare): tvTurnstile("id-del-contenedor") → { token(), reset() }.
// La clave pública sale de /api/config; el token se valida en el servidor.
window.tvTurnstile = (id, opciones = {}) => {
  let widget = null;
  const listo = fetch("/api/config")
    .then((r) => r.json())
    .then(
      (c) =>
        new Promise((resolve) => {
          const montar = () => { widget = window.turnstile.render("#" + id, { sitekey: c.turnstile_site_key, language: "es", ...opciones }); resolve(); };
          if (window.turnstile) return montar();
          window.__tvTsListo = montar;
          const s = document.createElement("script");
          s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tvTsListo";
          s.async = true;
          document.head.appendChild(s);
        })
    )
    .catch(() => {});
  return {
    listo,
    token: () => (widget !== null && window.turnstile ? window.turnstile.getResponse(widget) || "" : ""),
    reset: () => widget !== null && window.turnstile && window.turnstile.reset(widget)
  };
};


// Menú de hamburguesa (móvil): el botón se crea acá; el CSS lo muestra solo en pantallas angostas.
document.querySelectorAll(".cabecera").forEach((cab) => {
  const nav = cab.querySelector(".navegacion");
  if (!nav) return;
  if (!nav.id) nav.id = "menu-principal";
  const b = document.createElement("button");
  b.type = "button"; b.className = "menu-boton";
  b.setAttribute("aria-label", "Menú"); b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", nav.id);
  b.innerHTML = "<span></span><span></span><span></span>";
  nav.before(b);
  const poner = (abierto) => { cab.classList.toggle("abierta", abierto); b.setAttribute("aria-expanded", String(abierto)); };
  b.addEventListener("click", () => poner(!cab.classList.contains("abierta")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") poner(false); });
  document.addEventListener("click", (e) => { if (!cab.contains(e.target)) poner(false); });
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) poner(false); });
});


// Ejemplos animados (landing): carrusel de tarjetas en loop. La del frente tipea la pregunta, "consulta" a Textifika
// y muestra la respuesta con citas; al terminar pasa sola a la siguiente y vuelve a empezar al final.
// Con prefers-reduced-motion no se anima ni avanza solo: cada caso se ve completo y se cambia con los controles.
document.querySelectorAll("[data-ia]").forEach((ia) => {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tarjetas = [...ia.querySelectorAll("[data-escena]")];
  const puntos = [...ia.querySelectorAll("[data-ir]")];
  const pausa = ia.querySelector("[data-pausa]");
  const n = tarjetas.length;
  let actual = 0, corrida = 0, pausado = reducido;

  const partes = (esc) => {
    const texto = esc.querySelector("[data-tipeo]");
    const pasos = [...esc.querySelectorAll("[data-paso]")];
    return { esc, texto, fantasma: esc.querySelector("[data-fantasma]"), completo: texto.dataset.tipeo, pasos, tools: pasos.filter((p) => p.closest(".ia-tools")), resto: pasos.filter((p) => !p.closest(".ia-tools")) };
  };
  const poner = (e, k) => { e.texto.textContent = e.completo.slice(0, k); e.fantasma.textContent = e.completo.slice(k); };
  const resultadoTool = (t) => (t.hasAttribute("data-vacio") ? "vacio" : "listo");
  const limpiar = (e) => { e.esc.dataset.estado = ""; const c = e.esc.querySelector(".ia-cuerpo"); if (c) c.scrollTop = 0; e.pasos.forEach((p) => p.classList.remove("visible", "activo", "listo", "vacio")); poner(e, 0); };
  const mostrarTodo = (e) => {
    e.esc.dataset.estado = "listo"; poner(e, e.completo.length);
    e.tools.forEach((t) => t.classList.add(resultadoTool(t)));
    e.resto.forEach((p) => p.classList.add("visible"));
  };
  const ubicar = () => {
    tarjetas.forEach((t, k) => {
      const rel = (k - actual + n) % n;
      t.dataset.pos = rel === 0 ? "actual" : rel === 1 ? "siguiente" : rel === n - 1 ? "anterior" : "oculta";
      const fuera = rel !== 0;
      t.setAttribute("aria-hidden", String(fuera));
      t.inert = fuera;
    });
    puntos.forEach((b, k) => b.setAttribute("aria-current", String(k === actual)));
  };

  // En móvil el cuerpo tiene altura fija: sigue la última parte, como un chat (en escritorio no hay nada que desplazar).
  const seguir = (e) => { const c = e.esc.querySelector(".ia-cuerpo"); if (c && c.scrollHeight > c.clientHeight) c.scrollTo({ top: c.scrollHeight, behavior: reducido ? "auto" : "smooth" }); };

  async function reproducir() {
    const mia = ++corrida;
    const vigente = () => mia === corrida;
    tarjetas.forEach((t) => limpiar(partes(t)));
    const e = partes(tarjetas[actual]);
    // Las vecinas se ven con su respuesta completa, como en una pila de ejemplos.
    tarjetas.forEach((t, k) => { if (k !== actual) mostrarTodo(partes(t)); });
    if (reducido) return mostrarTodo(e);
    await espera(700); // deja terminar el deslizamiento
    e.esc.dataset.estado = "escribiendo";
    for (let i = 1; i <= e.completo.length; i++) { if (!vigente()) return; poner(e, i); await espera(e.completo[i - 1] === " " ? 38 : 26); }
    e.esc.dataset.estado = "consultando";
    await espera(500);
    for (const t of e.tools) { if (!vigente()) return; t.classList.add("activo"); seguir(e); await espera(850); t.classList.replace("activo", resultadoTool(t)); await espera(150); }
    await espera(250);
    for (const p of e.resto) { if (!vigente()) return; p.classList.add("visible"); setTimeout(() => seguir(e), 80); setTimeout(() => seguir(e), 620); await espera(p.classList.contains("ia-cita") || p.classList.contains("ia-nada") ? 1500 : 800); }
    e.esc.dataset.estado = "listo";
    await espera(4500);
    while (pausado && vigente()) await espera(400);
    if (vigente()) ir(actual + 1);
  }
  const ir = (k) => { actual = (k + n) % n; ubicar(); reproducir(); };

  tarjetas.forEach((t, k) => t.addEventListener("click", () => { if (k !== actual) ir(k); }));
  puntos.forEach((b, k) => b.addEventListener("click", () => ir(k)));
  ia.querySelectorAll("[data-mover]").forEach((b) => b.addEventListener("click", () => ir(actual + Number(b.dataset.mover))));
  ia.addEventListener("keydown", (ev) => { if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") { if (ev.target.closest("input,textarea")) return; ev.preventDefault(); ir(actual + (ev.key === "ArrowRight" ? 1 : -1)); } });
  pausa?.addEventListener("click", () => { pausado = !pausado; pausa.setAttribute("aria-pressed", String(pausado)); pausa.setAttribute("aria-label", pausado ? "Reanudar los ejemplos" : "Pausar los ejemplos"); });
  if (reducido && pausa) pausa.hidden = true;

  ubicar();
  tarjetas.forEach((t, k) => (k === actual ? limpiar(partes(t)) : mostrarTodo(partes(t))));
  if (reducido || !("IntersectionObserver" in window)) return reproducir();
  new IntersectionObserver((en, o) => { if (en[0].isIntersecting) { o.disconnect(); reproducir(); } }, { threshold: 0.2 }).observe(ia);
});
