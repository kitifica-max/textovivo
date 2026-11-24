import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filasParaConsulta, matchFts, mismaRaiz, planDeBusqueda, posicionLiteral, raiz, sugerenciasContextuales, ubicarCoincidencia, validarTerminos, type Termino
} from "./vocabulario.ts";

const T: Termino[] = [
  { termino: "liderazgo", traduccion: "commander", pagina: 1, fuente: "sinonimo" },
  { termino: "liderazgo", traduccion: "general", pagina: 1, fuente: "sinonimo" },
  { termino: "conocer al rival y a uno mismo", traduccion: "know the enemy and know yourself", pagina: 9, fuente: "framework" },
  { termino: "estrategias de ataque", traduccion: "stratagem", pagina: 8, fuente: "capitulo" },
  { termino: "rival", traduccion: "enemy", pagina: 2, fuente: "sinonimo" }
];

test("raíz: «lider» y «liderazgo» coinciden; plurales y derivadas en inglés también", () => {
  assert.ok(mismaRaiz("lider", "liderazgo"));
  assert.ok(mismaRaiz("strategies", "strategy"));
  assert.ok(mismaRaiz("headlines", "headline"));
  assert.ok(!mismaRaiz("guerra", "guerrero") || raiz("guerra").length >= 4);
  assert.ok(!mismaRaiz("soldier", "solitude"));
});

test("validarTerminos descarta lo que no está literal, corrige la página y no repite", () => {
  const paginas = [
    { pagina: 1, texto: "Intro. The Commander stands for wisdom." },
    { pagina: 2, texto: "Know the enemy and know yourself; in a hundred battles you will never be in peril." }
  ];
  const { buenos, descartados } = validarTerminos(
    [
      { termino: "liderazgo", traduccion: "commander", pagina: 2, fuente: "sinonimo" }, // página mal indicada → se corrige a 1
      { termino: "conocer al rival", traduccion: "know the enemy and know yourself", pagina: 2, fuente: "framework" },
      { termino: "liderazgo", traduccion: "commander", pagina: 1, fuente: "sinonimo" }, // repetida
      { termino: "beneficio", traduccion: "benefit", pagina: 1, fuente: "sinonimo" }, // no está en el texto
      { termino: "x", traduccion: "ab", pagina: 1, fuente: "sinonimo" }
    ],
    paginas
  );
  assert.deepEqual(buenos.map((b) => [b.traduccion, b.pagina]), [["commander", 1], ["know the enemy and know yourself", 2]]);
  assert.equal(descartados.length, 2);
});

test("posicionLiteral ignora tildes, mayúsculas y puntuación, pero no acepta mitades de palabra", () => {
  assert.equal(posicionLiteral("Hola, ¡Mundo cruel!", "mundo cruel"), 7);
  assert.equal(posicionLiteral("el ejército marcha", "ejercito"), 3);
  assert.equal(posicionLiteral("warrant", "war"), -1);
  assert.equal(posicionLiteral("warrant", "war", true), 0);
});

test("filasParaConsulta busca por palabras sueltas, no solo por la frase completa", () => {
  const filas = filasParaConsulta("cómo conocer al rival", T);
  assert.ok(filas.some((f) => f.traduccion === "know the enemy and know yourself"));
  assert.ok(filas.some((f) => f.traduccion === "enemy"));
  assert.deepEqual(filasParaConsulta("criptomonedas blockchain", T), []);
});

test("el plan va de lo literal a lo amplio y las páginas señaladas excluyen a los sinónimos sueltos", () => {
  const plan = planDeBusqueda("liderazgo", T);
  assert.deepEqual(plan.map((e) => e.etiqueta), ["completa", "expandida", "aproximada", "parcial"]);
  const exp = plan.find((e) => e.etiqueta === "expandida")!;
  assert.deepEqual(exp.usados, ["commander", "general"]);
  assert.deepEqual(exp.paginas, []); // «commander»/«general» son sinónimos: no señalan página
  assert.deepEqual(planDeBusqueda("estrategias de ataque", T).find((e) => e.etiqueta === "expandida")!.paginas, [8]);
  assert.equal(matchFts({ etiqueta: "expandida", modo: "or", piezas: [{ texto: "commander" }, { texto: "lead", prefijo: true }] }), '"commander" OR "lead"*');
});

test("sugerencias contextuales: cada consulta recibe las suyas; sin parecido, el listado general", () => {
  const ult = ["Ley moral", "Energía"];
  const a = sugerenciasContextuales("lidrazgo", T, ult); // error de tecleo
  const b = sugerenciasContextuales("estrategia de ataques", T, ult);
  assert.ok(a.contextuales && a.sugerencias.includes("commander"));
  assert.ok(b.contextuales && b.sugerencias.includes("stratagem"));
  assert.notDeepEqual(a.sugerencias, b.sugerencias);
  const c = sugerenciasContextuales("criptomonedas", T, ult);
  assert.deepEqual(c, { sugerencias: ult, contextuales: false });
});

test("ubicarCoincidencia dice qué pieza coincidió y dónde", () => {
  const u = ubicarCoincidencia("Uno dos tres. El commander manda.", [{ texto: "general" }, { texto: "command", prefijo: true }]);
  assert.deepEqual(u, { termino: "command", posicion: 17 });
  assert.equal(ubicarCoincidencia("nada", [{ texto: "general" }]), null);
});
