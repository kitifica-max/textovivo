import { test } from "node:test";
import assert from "node:assert/strict";
import destilado from "../data/libros/arte-de-la-guerra/destilado.json" with { type: "json" };
import paginas from "../data/libros/arte-de-la-guerra/paginas.json" with { type: "json" };
import ejemploDestilado from "../data/ejemplo/destilado.json" with { type: "json" };
import ejemploPaginas from "../data/ejemplo/paginas.json" with { type: "json" };
import { Destilado, Paginas } from "./schema.ts";
import {
  buscarConcepto,
  citarFuente,
  citasInvalidas,
  buscadorMemoria,
  crearLibro,
  listarIndice,
  obtenerChecklist,
  obtenerFramework,
  esSinResultado
} from "./tools.ts";

// Corre sobre el libro real cargado en data/: ninguna cita inventada llega al lector.
test("data/: el destilado es válido y el 100 % de las citas existe en su página", async () => {
  const d = Destilado.parse(destilado);
  const p = Paginas.parse(paginas);
  assert.deepEqual(citasInvalidas(d, p), []);
});

// Lógica de las herramientas sobre el libro de ejemplo fijo.
const libro = crearLibro(Destilado.parse(ejemploDestilado), buscadorMemoria(Paginas.parse(ejemploPaginas)));

test("listar_indice devuelve capítulos y nombres", async () => {
  const r = listarIndice(libro);
  assert.equal(r.capitulos.length, 4);
  assert.deepEqual(r.frameworks, ["Método de las tres preguntas"]);
});

test("buscar_concepto pone primero el glosario y encuentra la página correcta", async () => {
  const r = await buscarConcepto(libro, "fricción");
  assert.ok("glosario" in r && r.glosario?.pagina === 6);
  const t = await buscarConcepto(libro, "testimonio con cifras");
  assert.ok("resultados" in t && t.resultados[0].pagina_inicio === 3);
  assert.equal(t.resultados[0].seccion, "Capítulo 2. La prueba");
});

test("buscar_concepto dice claramente cuando no hay nada", async () => {
  assert.ok("mensaje" in await buscarConcepto(libro, "criptomonedas blockchain"));
});

test("obtener_framework por nombre aproximado", async () => {
  const r = obtenerFramework(libro, "tres preguntas para la promesa");
  assert.ok("pasos" in r && r.pasos.length === 4);
});

test("obtener_checklist por tema", async () => {
  const r = obtenerChecklist(libro, "antes de publicar");
  assert.ok("items" in r && r.items.length === 5);
});

test("citar_fuente devuelve una oración literal del texto", async () => {
  const r = await citarFuente(libro, "los botones genéricos no sirven");
  assert.ok("cita_literal" in r);
  assert.equal(r.pagina, 4);
  assert.ok(ejemploPaginas[3].texto.includes(r.cita_literal));
});

test("la frase exacta le gana a una página que repite una palabra", async () => {
  const mini = crearLibro(
    Destilado.parse({ id: "x", titulo: "x", autor: "x", indice: [], glosario: [], frameworks: [], checklists: [] }),
    buscadorMemoria([
      { pagina: 1, texto: "Strike at its head. Strike at its tail. Strike at its middle." },
      { pagina: 2, texto: "The way is to avoid what is strong and to strike at what is weak." }
    ])
  );
  const r = await buscarConcepto(mini, "strike at what is weak");
  assert.ok("resultados" in r && r.resultados[0].pagina_inicio === 2);
});

test("citasInvalidas detecta una cita inventada", async () => {
  const d = Destilado.parse(structuredClone(ejemploDestilado));
  d.glosario[0].cita = "Esta frase no está en el libro.";
  assert.equal(citasInvalidas(d, Paginas.parse(ejemploPaginas)).length, 1);
});

// --- Cambios a la búsqueda (CAMBIOS-BUSQUEDA.md, 1, 2, 5, 6, 7, 8) ---
const mini = (paginas: { pagina: number; texto: string }[], extra = {}) =>
  crearLibro(
    Destilado.parse({ id: "x", titulo: "x", autor: "x", idioma: "en", indice: [], glosario: [], frameworks: [], checklists: [], ...extra }),
    buscadorMemoria(paginas)
  );

test("AND antes que OR: gana la página con todos los términos y se marca completa", async () => {
  const l = mini([
    { pagina: 1, texto: "The general must know the enemy. The general rests." },
    { pagina: 2, texto: "Know the enemy and know yourself, and in a hundred battles you will never be in peril." }
  ]);
  const r = await buscarConcepto(l, "know enemy yourself");
  assert.ok("resultados" in r && r.coincidencia === "completa" && r.resultados.length === 1 && r.resultados[0].pagina_inicio === 2);
});

test("si ninguna página tiene todo, se usa OR y se avisa como parcial", async () => {
  const l = mini([
    { pagina: 1, texto: "The commander must be brave." },
    { pagina: 2, texto: "Terrain decides the battle." }
  ]);
  const r = await buscarConcepto(l, "commander terrain");
  assert.ok("resultados" in r && r.coincidencia === "parcial" && "nota" in r);
});

test("el umbral descarta las páginas de ruido (menos de la mitad de la mejor)", async () => {
  const l = mini([
    { pagina: 1, texto: "Terrain terrain terrain terrain: ground ground ground." },
    { pagina: 2, texto: "A single mention of ground in a long unrelated page about weather and seasons and rivers and mountains." }
  ]);
  const r = await buscarConcepto(l, "terrain ground");
  assert.ok("resultados" in r && r.resultados.length === 1 && r.resultados[0].pagina_inicio === 1);
});

test("sin resultados: sugerencias con términos del libro en su idioma", async () => {
  const l = mini([{ pagina: 1, texto: "Know the enemy." }], {
    glosario: [{ termino: "Stratagem", definicion: "d", pagina: 1, cita: "Know the enemy." }],
    frameworks: [{ nombre: "Know yourself", resumen: "r", verificado: true, pasos: [{ orden: 1, titulo: "t", descripcion: "d", pagina: 1, cita: "Know the enemy." }] }]
  });
  const r = await buscarConcepto(l, "liderazgo");
  assert.ok("sugerencias" in r && r.sugerencias?.includes("Stratagem") && r.sugerencias.includes("Know yourself"));
  assert.match(String(r.mensaje), /inglés/);
});

test("glosario por palabra entera: «war» no activa «warrant» ni «forward»", async () => {
  const l = mini([{ pagina: 1, texto: "War is deceit." }], {
    glosario: [{ termino: "Warrant", definicion: "d", pagina: 1, cita: "War" }]
  });
  assert.ok(!("glosario" in await buscarConcepto(l, "war")));
  assert.ok("glosario" in await buscarConcepto(l, "the warrant"));
});

test("obtener_framework no devuelve «el único que hay» si la consulta no coincide", async () => {
  const r = obtenerFramework(libro, "criptomonedas blockchain");
  assert.ok("mensaje" in r && !("pasos" in r));
});

test("citar_fuente mira varias páginas y ofrece otras candidatas si están parejas", async () => {
  const l = mini([
    { pagina: 1, texto: "A leader who lacks courage cannot win. Other things matter." },
    { pagina: 2, texto: "Courage in a leader decides every war. Nothing else is said." }
  ]);
  const r = await citarFuente(l, "a leader with courage");
  assert.ok("cita_literal" in r && r.otras_candidatas?.length === 1);
});

// --- Vocabulario por libro (expansión, sugerencias contextuales, dónde coincidió) ---
import { construirVocabulario } from "./vocabulario.ts";
import vocabArte from "../data/libros/arte-de-la-guerra/vocabulario.json" with { type: "json" };
const terminosArte = construirVocabulario(Destilado.parse(destilado), Paginas.parse(paginas), vocabArte).filas.filter((t) => t.verificado);
const arte = crearLibro(Destilado.parse(destilado), buscadorMemoria(Paginas.parse(paginas), terminosArte), async () => terminosArte);
const pagsDe = (r: any) => (r.resultados ?? []).map((x: any) => x.pagina_inicio as number);

test("vocabulario derivado del destilado: «ley moral» se traduce a «Moral Law» y la nota lo dice", async () => {
  const r: any = await buscarConcepto(arte, "ley moral");
  assert.equal(r.coincidencia, "expandida");
  assert.ok(r.resultados.every((x: any) => /moral law/i.test(x.texto)));
  assert.match(r.nota, /vocabulario del libro/);
  assert.ok(r.resultados[0].coincide_en.en_fragmento);
});

test("capítulos y parcial literal: «estrategias de ataque» trae el capítulo III y «attack by stratagem» lo pone primero", async () => {
  const a: any = await buscarConcepto(arte, "estrategias de ataque");
  assert.ok(pagsDe(a).some((p: number) => p >= 7 && p <= 9));
  const b: any = await buscarConcepto(arte, "attack by stratagem"); // en inglés: la p. 8 (capítulo III) sube sobre la p. 36 (capítulo XI)
  assert.ok(b.resultados[0].pagina_inicio >= 7 && b.resultados[0].pagina_inicio <= 9);
});

test("vocabulario.json (sinónimos revisados): «liderazgo» y «lider» traen la p. 1 (The Commander…) y solo páginas con commander, general o leader", async () => {
  for (const q of ["liderazgo", "lider"]) {
    const r: any = await buscarConcepto(arte, q);
    assert.ok(pagsDe(r).includes(1), q);
    assert.ok(r.resultados.every((x: any) => /command|general|leader/i.test(x.texto)), q);
  }
});

test("vocabulario: «conocer al enemigo y a ti mismo» trae la p. 9 en primer lugar y la consulta en inglés no cambia", async () => {
  const es: any = await buscarConcepto(arte, "conocer al enemigo y a ti mismo");
  assert.equal(es.resultados[0].pagina_inicio, 9);
  const en: any = await buscarConcepto(arte, "know the enemy and know yourself");
  assert.equal(en.coincidencia, "completa");
  assert.equal(en.resultados[0].pagina_inicio, 9);
  const f = obtenerFramework(arte, "Conocer al rival y a uno mismo");
  assert.ok("verificado" in f && f.verificado === true);
});

test("sin resultados: las sugerencias dependen de la consulta; solo el último recurso se repite", async () => {
  const typo: any = await buscarConcepto(arte, "moraal");
  assert.ok(typo.sugerencias.includes("Moral Law") && /Lo más parecido/.test(typo.mensaje));
  const a: any = await buscarConcepto(arte, "criptomonedas");
  const b: any = await buscarConcepto(arte, "bitcoin y blockchain");
  assert.ok(a.sugerencias && b.sugerencias);
  assert.deepEqual(a.sugerencias, b.sugerencias); // último recurso (nada se parece): listado general del libro
  assert.notDeepEqual(typo.sugerencias, a.sugerencias);
});

test("etiqueta de coincidencia: si el término queda más allá del fragmento recortado, se dice dónde", async () => {
  const largo = "relleno ".repeat(260) + "el commander decide."; // ≈ 2.080 caracteres: más que MAX_PASAJE (1.500)
  const l = crearLibro(Destilado.parse({ id: "x", titulo: "x", autor: "x", idioma: "en", indice: [], glosario: [], frameworks: [], checklists: [] }), buscadorMemoria([{ pagina: 1, texto: largo }]));
  const r: any = await buscarConcepto(l, "commander");
  assert.equal(r.coincidencia, "completa");
  assert.equal(r.resultados[0].texto.length, 1500);
  assert.equal(r.resultados[0].coincide_en.termino, "commander");
  assert.equal(r.resultados[0].coincide_en.en_fragmento, false);
  assert.ok(r.resultados[0].coincide_en.posicion > 1500);
  assert.match(r.aviso_fragmento, /más allá del fragmento/);
  const corto: any = await buscarConcepto(arte, "commander");
  assert.ok(corto.resultados.every((x: any) => x.coincide_en?.en_fragmento === true));
});

test("esSinResultado: solo marca las respuestas que son únicamente un «No encontré…» / «No hay…»", async () => {
  assert.equal(esSinResultado(await buscarConcepto(libro, "criptomonedas blockchain")), true);
  assert.equal(esSinResultado(await buscarConcepto(libro, "testimonio con cifras")), false);
  assert.equal(esSinResultado(await buscarConcepto(libro, "fricción")), false); // glosario aunque no haya páginas
  assert.equal(esSinResultado(obtenerFramework(libro, "criptomonedas blockchain")), true);
  assert.equal(esSinResultado(obtenerFramework(libro, "tres preguntas para la promesa")), false);
  assert.equal(esSinResultado(await citarFuente(libro, "los botones genéricos no sirven")), false);
  assert.equal(esSinResultado({ mensaje: "El libro «x» no existe." }), false); // libro inexistente: no es una búsqueda sin resultado
  assert.equal(esSinResultado(null), false);
});
