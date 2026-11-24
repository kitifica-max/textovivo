import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoPendiente, diasRestantes, extenderVencimiento, firmaHmac, firmaValida, iguales, leerEvento, montoCoincide, planEfectivo } from "./plan.ts";

const hoy = "2026-11-24T12:00:00.000Z";

test("el plan vence a la fecha y el otorgado a mano no vence", () => {
  assert.equal(planEfectivo("pro", "2026-12-01T00:00:00.000Z", hoy), "pro");
  assert.equal(planEfectivo("pro", "2026-11-20T00:00:00.000Z", hoy), "gratis");
  assert.equal(planEfectivo("pro", null, hoy), "pro");
  assert.equal(planEfectivo("gratis", "2030-01-01T00:00:00.000Z", hoy), "gratis");
});

test("renovar antes de vencer suma los 30 días al final, sin perder los que quedaban", () => {
  assert.equal(extenderVencimiento(null, hoy), "2026-12-24T12:00:00.000Z");
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
