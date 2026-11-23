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
