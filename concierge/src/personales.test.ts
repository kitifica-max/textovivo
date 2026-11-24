import { test } from "node:test";
import assert from "node:assert/strict";
import { Destilado } from "./schema.ts";
import { datosDestilado, esIdPersonal, planHabilitado, puedeVer } from "./personales.ts";

test("solo el dueño ve su documento personal", () => {
  assert.equal(puedeVer("u1", "u1"), true);
  assert.equal(puedeVer("u1", "u2"), false);
  assert.equal(puedeVer("u1", null), false);
});

test("los ids personales se reconocen por el prefijo", () => {
  assert.equal(esIdPersonal("mi-ab12cd34ef"), true);
  assert.equal(esIdPersonal("principe"), false);
});

test("los planes habilitados salen de la configuración", () => {
  assert.equal(planHabilitado("pro", "pro"), true);
  assert.equal(planHabilitado("gratis", "pro"), false);
  assert.equal(planHabilitado("gratis", "*"), true);
  assert.equal(planHabilitado("gratis", ""), false);
});

test("un documento personal arma un libro válido para el conector", () => {
  const d = Destilado.parse(datosDestilado({ id: "mi-x", titulo: "Mi contrato", idioma: "es", paginacion: "pdf", indice: JSON.stringify([{ titulo: "Páginas 1-3", nivel: 1, pagina_inicio: 1, pagina_fin: 3 }]) }));
  assert.equal(d.autor, "Documento personal");
  assert.equal(d.frameworks.length, 0);
});
