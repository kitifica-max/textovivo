// Informe del vocabulario por libro (tabla terminos). No genera nada ni llama a ningún modelo:
// el vocabulario = lo derivado del destilado + data/libros/<id>/vocabulario.json (escrito a mano), todo validado contra el texto (construirVocabulario, src/vocabulario.ts).
//   node scripts/terminos.ts            cobertura de todos los libros
//   node scripts/terminos.ts <id>       detalle de un libro (qué quedó con traducción y qué sin ella)
import { readFile } from "node:fs/promises";
import { Paginas } from "../src/schema.ts";
import { construirVocabulario, type Candidato } from "../src/vocabulario.ts";

const leer = async (r: string) => JSON.parse(await readFile(r, "utf8"));
const catalogo = await leer("data/catalogo.json");
const ids = process.argv.slice(2);
for (const d of catalogo.filter((x: { id: string }) => !ids.length || ids.includes(x.id))) {
  const manual: Candidato[] = await leer(`data/libros/${d.id}/vocabulario.json`).catch(() => []);
  const { filas, descartados } = construirVocabulario(d, Paginas.parse(await leer(`data/libros/${d.id}/paginas.json`)), manual);
  const ok = filas.filter((f) => f.verificado).length;
  console.log(`${d.id.padEnd(26)} ${String(filas.length).padStart(3)} términos · ${String(ok).padStart(3)} con traducción literal · ${String(filas.length - ok).padStart(3)} sin traducción${descartados.length ? ` · ${descartados.length} filas manuales NO literales` : ""}`);
  if (ids.length) for (const f of filas) console.log(`   ${f.verificado ? "✓" : "·"} p.${String(f.pagina).padStart(2)} [${f.fuente}] ${f.termino.slice(0, 60)}${f.verificado ? ` → ${f.traduccion}` : ""}`);
}
