import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoPendiente, diasRestantes, extenderVencimiento, firmaHmac, firmaValida, firmarToken, iguales, leerEvento, leerToken, luhn, marcaTarjeta, montoCoincide, planEfectivo, separarNombre, validarTarjeta } from "./plan.ts";

const hoy = "2026-11-24T12:00:00.000Z";

test("el plan vence a la fecha y el otorgado a mano no vence", () => {
  assert.equal(planEfectivo("pro", "2026-12-01T00:00:00.000Z", hoy), "pro");
  assert.equal(planEfectivo("pro", "2026-11-20T00:00:00.000Z", hoy), "gratis");
  assert.equal(planEfectivo("pro", null, hoy), "pro");
  assert.equal(planEfectivo("gratis", "2030-01-01T00:00:00.000Z", hoy), "gratis");
});

test("renovar antes de vencer suma los 30 días al final, sin perder los que quedaban", () => {
  assert.equal(extenderVencimiento(null, hoy), "2026-12-24T12:00:00.000Z");
  // Regla del acceso a la biblioteca: el pago suma 30 días sobre los que quedan (30 gratis + 30 pagados ≈ 60).
  assert.equal(extenderVencimiento("2026-12-24T12:00:00.000Z", hoy, 30), "2027-01-23T12:00:00.000Z");
  assert.equal(extenderVencimiento("2026-12-01T12:00:00.000Z", hoy), "2026-12-31T12:00:00.000Z");
  assert.equal(extenderVencimiento("2026-11-01T12:00:00.000Z", hoy), "2026-12-24T12:00:00.000Z"); // ya vencido: cuenta desde hoy
  assert.equal(diasRestantes("2026-12-01T12:00:00.000Z", hoy), 7);
});

test("los avisos de vencimiento salen una vez cada uno y solo avanzan", () => {
  assert.equal(avisoPendiente("2026-12-10T12:00:00.000Z", 0, hoy), 0);          // faltan 16 días
  assert.equal(avisoPendiente("2026-11-30T12:00:00.000Z", 0, hoy), 1);          // faltan 6
  assert.equal(avisoPendiente("2026-11-30T12:00:00.000Z", 1, hoy), 0);          // ya se avisó
  assert.equal(avisoPendiente("2026-11-25T06:00:00.000Z", 1, hoy), 2);          // falta menos de 1 día
  assert.equal(avisoPendiente("2026-11-25T06:00:00.000Z", 2, hoy), 0);
  assert.equal(avisoPendiente("2026-11-20T00:00:00.000Z", 0, hoy), 0);          // ya venció
});

test("la firma del webhook se valida con el cuerpo exacto y el secreto", async () => {
  const cuerpo = '{"IdTransaccion":"abc","Monto":4.99}';
  const f = await firmaHmac("secreto", cuerpo);
  assert.match(f, /^[0-9a-f]{64}$/);
  assert.equal(await firmaValida("secreto", cuerpo, f), true);
  assert.equal(await firmaValida("secreto", cuerpo, f.toUpperCase()), true);
  assert.equal(await firmaValida("otro", cuerpo, f), false);
  assert.equal(await firmaValida("secreto", cuerpo + " ", f), false);   // un espacio de más rompe la firma
  assert.equal(await firmaValida("secreto", cuerpo, null), false);
  assert.equal(await firmaValida("", cuerpo, f), false);
});

test("la comparación en tiempo constante distingue largos y contenidos", () => {
  assert.equal(iguales("abc", "abc"), true);
  assert.equal(iguales("abc", "abd"), false);
  assert.equal(iguales("abc", "abcd"), false);
});

test("el evento del webhook se lee con lo mínimo y rechaza lo incompleto", () => {
  const e = leerEvento({ IdTransaccion: "t1", Monto: 4.99, ResultadoTransaccion: "ExitosaAprobada", EsProductiva: false, EnlacePago: { Id: 9, IdentificadorEnlaceComercio: "p1" } });
  assert.deepEqual(e, { idTransaccion: "t1", pagoId: "p1", monto: 4.99, resultado: "ExitosaAprobada", esProductiva: false });
  assert.equal(leerEvento({ IdTransaccion: "t1" }), null);
  assert.equal(leerEvento(null), null);
});

test("el monto debe coincidir (con tolerancia de centavos)", () => {
  assert.equal(montoCoincide(4.99, 4.99), true);
  assert.equal(montoCoincide(4.99, 0.99), false);
  assert.equal(montoCoincide(NaN, 4.99), false);
});

test("el token de pago sirve 15 minutos, solo para su pago y su cuenta, y no se puede alterar", async () => {
  const ahora = 1_700_000_000_000;
  const tk = await firmarToken("secreto", "pago1", "user1", ahora);
  assert.deepEqual(await leerToken("secreto", tk, ahora + 60_000), { pagoId: "pago1", userId: "user1" });
  assert.equal(await leerToken("secreto", tk, ahora + 16 * 60_000), null);          // vencido
  assert.equal(await leerToken("otro", tk, ahora + 1000), null);                    // otro secreto
  const [cuerpo, firma] = tk.split(".");
  const alterado = btoa(JSON.stringify({ p: "pago2", u: "user1", e: ahora + 999999999 })).replace(/=+$/, "");
  assert.equal(await leerToken("secreto", `${alterado}.${firma}`, ahora + 1000), null);
  assert.equal(await leerToken("secreto", "basura", ahora), null);
  assert.ok(cuerpo.length > 10);
});

test("Luhn y marcas: acepta tarjetas de prueba válidas y rechaza el resto", () => {
  assert.equal(luhn("4111111111111111"), true);
  assert.equal(luhn("4111111111111112"), false);
  assert.equal(marcaTarjeta("4111111111111111"), "visa");
  assert.equal(marcaTarjeta("5555555555554444"), "mastercard");
  assert.equal(marcaTarjeta("378282246310005"), "otra");   // American Express: no se acepta
});

test("la tarjeta se valida entera en el servidor", () => {
  const ok = { nombre: "Ana Pérez", numero: "4111 1111 1111 1111", cvv: "123", mes: 12, anio: 2030 };
  const hoy = new Date("2026-11-24T00:00:00Z");
  assert.equal(validarTarjeta(ok, hoy), null);
  assert.match(String(validarTarjeta({ ...ok, numero: "4111111111111112" }, hoy)), /número/);
  assert.match(String(validarTarjeta({ ...ok, numero: "378282246310005" }, hoy)), /Visa y Mastercard/);
  assert.match(String(validarTarjeta({ ...ok, anio: 2025 }, hoy)), /vencida/);
  assert.match(String(validarTarjeta({ ...ok, mes: 10, anio: 2026 }, hoy)), /vencida/);
  assert.match(String(validarTarjeta({ ...ok, cvv: "12" }, hoy)), /CVV/);
  assert.match(String(validarTarjeta({ ...ok, nombre: "" }, hoy)), /nombre/);
});

test("el nombre se separa en nombre y apellido", () => {
  assert.deepEqual(separarNombre("Ana María Pérez"), { nombre: "Ana", apellido: "María Pérez" });
  assert.deepEqual(separarNombre("Madonna"), { nombre: "Madonna", apellido: "Madonna" });
});
