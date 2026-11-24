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
document.querySelectorAll('[role="tablist"]').forEach((lista) => {
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


// Ejemplo animado (landing): tipea la pregunta, "consulta" a Textifika y muestra la respuesta con citas.
// Con prefers-reduced-motion se muestra todo de una vez. Empieza al entrar en pantalla; «Ver de nuevo» la repite.
document.querySelectorAll("[data-ia]").forEach((ia) => {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const texto = ia.querySelector("[data-tipeo]");
  const fantasma = ia.querySelector("[data-fantasma]");
  const completo = texto.dataset.tipeo;
  const pasos = [...ia.querySelectorAll("[data-paso]")];
  const tools = pasos.filter((p) => p.closest(".ia-tools"));
  const citas = ia.querySelectorAll(".ia-cita");
  let corrida = 0;

  const poner = (n) => { texto.textContent = completo.slice(0, n); fantasma.textContent = completo.slice(n); };
  const limpiar = () => {
    ia.dataset.estado = "";
    pasos.forEach((p) => p.classList.remove("visible", "activo", "listo"));
    poner(0);
  };
  const mostrarTodo = () => {
    ia.dataset.estado = "listo"; poner(completo.length);
    tools.forEach((t) => t.classList.add("listo"));
    pasos.filter((p) => !p.closest(".ia-tools")).forEach((p) => p.classList.add("visible"));
  };

  async function reproducir() {
    const mia = ++corrida;
    limpiar();
    if (reducido) return mostrarTodo();
    const vigente = () => mia === corrida;
    ia.dataset.estado = "escribiendo";
    for (let i = 1; i <= completo.length; i++) { if (!vigente()) return; poner(i); await espera(completo[i - 1] === " " ? 38 : 26); }
    ia.dataset.estado = "consultando";
    await espera(500);
    for (const t of tools) { if (!vigente()) return; t.classList.add("activo"); await espera(850); t.classList.replace("activo", "listo"); await espera(150); }
    await espera(250);
    const resto = pasos.filter((p) => !p.closest(".ia-tools"));
    for (const p of resto) { if (!vigente()) return; p.classList.add("visible"); await espera(p.classList.contains("ia-cita") ? 1500 : 800); }
    ia.dataset.estado = "listo";
  }

  ia.querySelector("[data-repetir]")?.addEventListener("click", reproducir);
  if (reducido || !("IntersectionObserver" in window)) return reproducir();
  limpiar();
  new IntersectionObserver((e, o) => { if (e[0].isIntersecting) { o.disconnect(); reproducir(); } }, { threshold: 0.2 }).observe(ia);
});
