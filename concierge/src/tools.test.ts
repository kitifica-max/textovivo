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
  obtenerFramework
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
