// Formulario de pago propio. La tarjeta va del navegador directo al Worker (no pasa por Netlify), cifrada por HTTPS.
// Esta página no carga ningún script de terceros (lo exige la política de seguridad de /pago/) y no guarda ni registra la tarjeta.
const $ = (id) => document.getElementById(id);
const post = (url, cuerpo) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo), credentials: url.startsWith("/") ? "same-origin" : "omit" })
  .then(async (r) => ({ ok: r.ok, status: r.status, datos: await r.json().catch(() => ({})) }))
  .catch(() => ({ ok: false, status: 0, datos: { error: "Sin conexión. Revisá tu internet e intentá de nuevo." } }));

// El pago lo crea Mi biblioteca (después de la verificación de Turnstile) y lo deja en sessionStorage; esta página no carga scripts de terceros.
let sesion = null; // { pago, token, destino }: se reutiliza mientras el pago no haya llegado a Wompi
try { sesion = JSON.parse(sessionStorage.getItem("tv_pago") || "null"); } catch { sesion = null; }
let precio = 4.99;
const usd = (n) => "US$" + Number(n).toFixed(2);

function marca(num) { return /^4/.test(num) ? "visa" : /^(5[1-5]|2[2-7])/.test(num) ? "mastercard" : /^3[47]/.test(num) ? "amex" : ""; }
function luhn(num) { let s = 0, d = false; for (let i = num.length - 1; i >= 0; i--) { let n = +num[i]; if (d) { n *= 2; if (n > 9) n -= 9; } s += n; d = !d; } return num.length >= 13 && s % 10 === 0; }

function error(msg) { const e = $("error"); e.textContent = msg; e.style.display = msg ? "block" : "none"; if (msg) e.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
function espera(on, txt) { $("espera").classList.toggle("v", on); if (txt) $("espera-txt").textContent = txt; }

$("f-numero").addEventListener("input", (e) => {
  const v = e.target.value.replace(/\D/g, "").slice(0, 16);
  e.target.value = v.replace(/(.{4})/g, "$1 ").trim();
  const m = marca(v);
  const ok = m === "visa" || m === "mastercard" ? m : "";
  $("marca").dataset.detectada = ok;                                   // logo dentro del campo
  document.querySelector(".marcas").dataset.detectada = ok;            // el otro logo se atenúa
  const ayuda = $("ayuda-numero"), mal = (m === "amex" && v.length >= 4) || (v.length >= 4 && !m);
  ayuda.textContent = mal ? (m === "amex" ? "No aceptamos American Express. Usá Visa o Mastercard." : "Solo aceptamos Visa y Mastercard.") : "";
  ayuda.classList.toggle("error", mal);
});
$("f-venc").addEventListener("input", (e) => { let v = e.target.value.replace(/\D/g, "").slice(0, 4); if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2); e.target.value = v; });
$("f-cvv").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3); });

function validar() {
  const nombre = $("f-nombre").value.trim(), num = $("f-numero").value.replace(/\D/g, ""), venc = $("f-venc").value, cvv = $("f-cvv").value.replace(/\D/g, "");
  if (nombre.length < 2) return ["f-nombre", "Escribí el nombre que aparece en la tarjeta."];
  if (num.length < 15 || !luhn(num)) return ["f-numero", "El número de tarjeta no es válido."];
  if (marca(num) !== "visa" && marca(num) !== "mastercard") return ["f-numero", "Solo aceptamos Visa y Mastercard."];
  const [mm, aa] = venc.split("/"), mes = parseInt(mm, 10), anio = 2000 + parseInt(aa, 10), hoy = new Date();
  if (!venc.includes("/") || venc.length < 5 || !(mes >= 1 && mes <= 12)) return ["f-venc", "Ingresá el vencimiento como MM/AA."];
  if (anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes < hoy.getMonth() + 1)) return ["f-venc", "La tarjeta está vencida."];
  if (cvv.length !== 3) return ["f-cvv", "El CVV tiene 3 dígitos."];
  return null;
}

async function pagar(ev) {
  ev.preventDefault();
  error("");
  document.querySelectorAll(".campo.mal").forEach((c) => c.classList.remove("mal"));
  const falla = validar();
  if (falla) { $(falla[0]).closest(".campo").classList.add("mal"); $(falla[0]).focus(); return error(falla[1]); }

  const boton = $("pagar"); boton.disabled = true; espera(true, "Procesando tu pago…");
  const [mm, aa] = $("f-venc").value.split("/");
  const tarjeta = { nombre: $("f-nombre").value.trim(), numero: $("f-numero").value.replace(/\D/g, ""), cvv: $("f-cvv").value.replace(/\D/g, ""), mes: parseInt(mm, 10), anio: 2000 + parseInt(aa, 10) };

  if (!sesion) { espera(false); boton.disabled = false; return error("Tu sesión de pago venció. Volvé a Mi biblioteca y tocá «Activar Pro»."); }
  espera(true, "Verificando con tu banco…");
  const r = await post(sesion.destino, { token: sesion.token, ...tarjeta });
  // Los datos de la tarjeta ya no se necesitan en pantalla: se borran del formulario.
  tarjeta.numero = tarjeta.cvv = ""; $("f-numero").value = ""; $("f-cvv").value = "";
  if (r.ok && r.datos.url3ds) { try { sessionStorage.removeItem("tv_pago"); } catch {} espera(true, "Redirigiendo a la verificación de tu banco…"); location.href = r.datos.url3ds; return; }
  if ([401, 409, 429].includes(r.status)) { sesion = null; try { sessionStorage.removeItem("tv_pago"); } catch {} } // el pago ya no sirve: hay que abrir uno nuevo desde Mi biblioteca
  espera(false); boton.disabled = false;
  error(r.datos.error || "No pudimos procesar el pago. Probá de nuevo.");
}

async function iniciar() {
  const yo = await fetch("/api/yo", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!yo) { location.replace("/entrar.html?next=mi-biblioteca.html"); return; }
  if (!sesion) { location.replace("/mi-biblioteca.html"); return; } // sin pago iniciado (y verificado) no hay nada que cobrar
  $("f-email").value = yo.usuario.email;
  if (!$("f-nombre").value) $("f-nombre").value = yo.usuario.nombre || "";
  if (!yo.usuario.verificado) { $("pagar").disabled = true; error("Confirmá tu email antes de pagar. Te mandamos un correo al crear la cuenta."); }
  const plan = await fetch("/api/plan", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (plan) {
    precio = plan.precio;
    $("precio").innerHTML = usd(plan.precio) + "<small>por " + plan.dias + " días</small>";
    $("pagar").textContent = "Pagar " + usd(plan.precio);
    if (!plan.cobro_activo) { $("pagar").disabled = true; error("El cobro todavía no está activo. Volvé en unos días."); }
  }
}
$("form-pago").addEventListener("submit", pagar);
iniciar();
