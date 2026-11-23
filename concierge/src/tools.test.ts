import { test } from "node:test";
import assert from "node:assert/strict";
import destilado from "../data/destilado.json" with { type: "json" };
import paginas from "../data/paginas.json" with { type: "json" };
import ejemploDestilado from "../data/ejemplo/destilado.json" with { type: "json" };
import ejemploPaginas from "../data/ejemplo/paginas.json" with { type: "json" };
import { Destilado, Paginas } from "./schema.ts";
import {
  buscarConcepto,
  citarFuente,
  citasInvalidas,
  crearLibro,
  listarIndice,
  obtenerChecklist,
  obtenerFramework
} from "./tools.ts";

// Corre sobre el libro real cargado en data/: ninguna cita inventada llega al lector.
test("data/: el destilado es válido y el 100 % de las citas existe en su página", () => {
  const d = Destilado.parse(destilado);
  const p = Paginas.parse(paginas);
  assert.deepEqual(citasInvalidas(d, p), []);
});

// Lógica de las herramientas sobre el libro de ejemplo fijo.
const libro = crearLibro(Destilado.parse(ejemploDestilado), Paginas.parse(ejemploPaginas));

test("listar_indice devuelve capítulos y nombres", () => {
  const r = listarIndice(libro);
  assert.equal(r.capitulos.length, 4);
  assert.deepEqual(r.frameworks, ["Método de las tres preguntas"]);
});

test("buscar_concepto pone primero el glosario y encuentra la página correcta", () => {
  const r = buscarConcepto(libro, "fricción");
  assert.ok("glosario" in r && r.glosario?.pagina === 6);
  const t = buscarConcepto(libro, "testimonio con cifras");
  assert.ok("resultados" in t && t.resultados[0].pagina_inicio === 3);
  assert.equal(t.resultados[0].seccion, "Capítulo 2. La prueba");
});

test("buscar_concepto dice claramente cuando no hay nada", () => {
  assert.ok("mensaje" in buscarConcepto(libro, "criptomonedas blockchain"));
});

test("obtener_framework por nombre aproximado", () => {
  const r = obtenerFramework(libro, "tres preguntas para la promesa");
  assert.ok("pasos" in r && r.pasos.length === 4);
});

test("obtener_checklist por tema", () => {
  const r = obtenerChecklist(libro, "antes de publicar");
  assert.ok("items" in r && r.items.length === 5);
});

test("citar_fuente devuelve una oración literal del texto", () => {
  const r = citarFuente(libro, "los botones genéricos no sirven");
  assert.ok("cita_literal" in r);
  assert.equal(r.pagina, 4);
  assert.ok(ejemploPaginas[3].texto.includes(r.cita_literal));
});

test("la frase exacta le gana a una página que repite una palabra", () => {
  const mini = crearLibro(
    Destilado.parse({ id: "x", titulo: "x", autor: "x", indice: [], glosario: [], frameworks: [], checklists: [] }),
    [
      { pagina: 1, texto: "Strike at its head. Strike at its tail. Strike at its middle." },
      { pagina: 2, texto: "The way is to avoid what is strong and to strike at what is weak." }
    ]
  );
  const r = buscarConcepto(mini, "strike at what is weak");
  assert.ok("resultados" in r && r.resultados[0].pagina_inicio === 2);
});

test("citasInvalidas detecta una cita inventada", () => {
  const d = Destilado.parse(structuredClone(ejemploDestilado));
  d.glosario[0].cita = "Esta frase no está en el libro.";
  assert.equal(citasInvalidas(d, Paginas.parse(ejemploPaginas)).length, 1);
});
