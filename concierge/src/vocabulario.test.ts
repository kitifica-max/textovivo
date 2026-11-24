import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirVocabulario, derivarTerminos, filasParaConsulta, matchFts, separarNombre, mismaRaiz, planDeBusqueda, posicionLiteral, raiz, sugerenciasContextuales, ubicarCoincidencia, validarTerminos, type Termino
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

test("derivarTerminos: nombre y descripción en español, traducción entre paréntesis solo si está literal; si no, sin traducción y marcada", () => {
  const paginas = [
    { pagina: 1, texto: "The Commander stands for wisdom. The Moral Law causes the people to be in complete accord." },
    { pagina: 2, texto: "Nothing else here." }
  ];
  const filas = derivarTerminos(
    {
      glosario: [
        { termino: "Ley moral (Moral Law)", definicion: "Acuerdo entre el pueblo y su líder.", pagina: 2 },
        { termino: "Shuai-jan", definicion: "Una serpiente de la montaña.", pagina: 2 }
      ],
      frameworks: [{ nombre: "Jerarquía de estrategias (Attack by stratagem)", resumen: "Mejor vencer sin pelear.", pasos: [{ pagina: 1 }] }],
      checklists: []
    },
    paginas
  );
  const ley = filas.filter((f) => f.termino.startsWith("Ley moral") || f.termino.startsWith("Acuerdo"));
  assert.ok(ley.length === 2 && ley.every((f) => f.traduccion === "Moral Law" && f.pagina === 1 && f.verificado && f.fuente === "glosario")); // la traducción se halla en p.1, aunque la cita era de p.2
  assert.ok(filas.filter((f) => f.fuente === "framework").every((f) => f.traduccion === "" && !f.verificado)); // «Attack by stratagem» no está literal
  assert.ok(filas.filter((f) => f.termino.startsWith("Shuai") || f.termino.startsWith("Una serpiente")).every((f) => f.traduccion === "" && !f.verificado)); // sin paréntesis
  assert.deepEqual(separarNombre("Ley moral (Moral Law)"), { es: "Ley moral", en: "Moral Law" });
  assert.deepEqual(separarNombre("Shuai-jan"), { es: "Shuai-jan", en: "" });
});

test("capítulos con paréntesis se derivan; si el paréntesis no está literal se usa su palabra más rara que sí lo esté (derivado-parcial)", () => {
  const paginas = [
    { pagina: 7, texto: "In the practical art of war, the best thing is to take the enemy's country whole." },
    { pagina: 8, texto: "This is the method of attacking by stratagem. The stratagem wins." },
    { pagina: 9, texto: "Nothing about it." }
  ];
  const filas = derivarTerminos(
    { indice: [{ titulo: "Capítulo III. Atacar con estratagemas (Attack By Stratagem)", pagina_inicio: 7, pagina_fin: 9 }, { titulo: "Capítulo IV. Sin paréntesis", pagina_inicio: 9, pagina_fin: 9 }], glosario: [], frameworks: [], checklists: [] },
    paginas
  );
  assert.equal(filas.length, 1); // el capítulo sin paréntesis no aporta traducción: no se deriva
  assert.deepEqual([filas[0].termino, filas[0].traduccion, filas[0].pagina, filas[0].fuente, filas[0].verificado], ["Atacar con estratagemas", "stratagem", 8, "derivado-parcial", true]);
});

test("construirVocabulario suma lo manual validado, no duplica lo derivado y reporta lo que ya no está literal", () => {
  const paginas = [{ pagina: 1, texto: "The Moral Law causes the people to be in accord. The Commander stands for wisdom." }];
  const d = { glosario: [{ termino: "Ley moral (Moral Law)", definicion: "Acuerdo.", pagina: 1 }], frameworks: [], checklists: [] };
  const { filas, descartados } = construirVocabulario(d, paginas, [
    { termino: "liderazgo", traduccion: "commander", pagina: 1, fuente: "sinonimo" },
    { termino: "Ley moral", traduccion: "Moral Law", pagina: 1, fuente: "sinonimo" }, // ya derivada
    { termino: "beneficio", traduccion: "benefit", pagina: 1, fuente: "sinonimo" } // no está en el texto
  ]);
  assert.equal(descartados.length, 1);
  assert.equal(filas.filter((f) => f.traduccion === "Moral Law").length, 2); // nombre + descripción derivados, sin la repetida manual
  assert.ok(filas.some((f) => f.termino === "liderazgo" && f.traduccion === "commander" && f.verificado));
});

import { patronesDeConsulta } from "./vocabulario.ts";
import { filasAutomaticas, leerDiccionario } from "../scripts/vocabulario-auto.ts";

test("patronesDeConsulta: palabras con contenido y su raíz (para que «lider» traiga «liderazgo»), sin comodines", () => {
  assert.deepEqual(patronesDeConsulta("el liderazgo de los ejércitos"), ["liderazgo", "lider", "ejercitos", "ejercit"]);
  assert.ok(patronesDeConsulta("liderazgo").includes("lider"));
  assert.ok(patronesDeConsulta("a y el").length === 0);
  assert.ok(patronesDeConsulta("50%_off").every((p) => !/[%_]/.test(p)));
});

test("vocabulario automático: traduce las palabras del libro que el diccionario conoce y no las demasiado comunes", () => {
  const tei = `<entry><form><orth>commander</orth></form><sense><cit type="trans" xml:lang="es"><quote>comandante</quote></cit></sense></entry>
<entry><form><orth>army</orth></form><sense><cit type="trans" xml:lang="es"><quote>ejército</quote></cit><cit type="trans" xml:lang="es"><quote>ejército (de tierra)</quote></cit></sense></entry>
<entry><form><orth>enemy</orth></form><sense><cit type="trans" xml:lang="es"><quote>enemigo</quote></cit></sense></entry>`;
  const dic = leerDiccionario(tei);
  const paginas = [
    { pagina: 1, texto: "The commander leads the army against the enemy." },
    { pagina: 2, texto: "The commanders meet. Enemy lines hold." },
    ...Array.from({ length: 8 }, (_, i) => ({ pagina: i + 3, texto: "Enemy enemy enemy everywhere." }))
  ];
  const filas = filasAutomaticas(paginas, dic);
  assert.ok(filas.some((f) => f.termino === "comandante" && f.traduccion === "commander" && f.pagina === 1 && f.fuente === "diccionario"));
  assert.ok(filas.some((f) => f.termino === "comandante" && f.traduccion === "commanders")); // forma literal del texto, traducida por su base
  assert.ok(filas.some((f) => f.termino === "ejército" && f.traduccion === "army"));
  assert.ok(filas.some((f) => f.termino === "ejército" && f.traduccion === "army") && filas.some((f) => f.termino === "ejército"));
  assert.ok(!filas.some((f) => f.traduccion === "enemy")); // aparece en 9 de 10 páginas: demasiado común para distinguir
});
