// Arma data/libros/<id>/extras.json desde extras.src.json.
// En el .src cada elemento trae `buscar`: el comienzo literal de la cita en el libro.
// El script encuentra la página y copia la cita del texto (nunca se escribe a mano).
// Uso: node scripts/armar-extras.ts <id>
import { readFile, writeFile } from "node:fs/promises";

const id = process.argv[2];
const dir = `data/libros/${id}`;
const paginas: { pagina: number; texto: string }[] = JSON.parse(await readFile(`${dir}/paginas.json`, "utf8"));
const src = JSON.parse(await readFile(`${dir}/extras.src.json`, "utf8"));

const plano = (s: string) => s.replace(/\s+/g, " ");
type Ref = { buscar: string; palabras?: number; pagina?: number; desde?: number };
function resolver({ buscar, palabras = 18, pagina, desde = 1 }: Ref) {
  const q = plano(buscar).toLowerCase();
  for (const p of paginas) {
    if ((pagina && p.pagina !== pagina) || p.pagina < desde) continue;
    const t = plano(p.texto);
    const i = t.toLowerCase().indexOf(q);
    if (i < 0) continue;
    const cita = t.slice(i).split(" ").slice(0, palabras).join(" ").replace(/[,;:\s]+$/, "");
    return { pagina: p.pagina, cita };
  }
  throw new Error(`${id}: no encuentro «${buscar}»`);
}
const quitar = <T extends Ref>({ buscar, palabras, pagina, desde, ...resto }: T) => resto;

const extras = {
  glosario: (src.glosario ?? []).map((g: Ref & object) => ({ ...quitar(g), ...resolver(g) })),
  frameworks: (src.frameworks ?? []).map((f: { pasos: (Ref & object)[] }) => ({
    ...f,
    pasos: f.pasos.map((p, k) => ({ orden: k + 1, ...quitar(p), ...resolver(p) }))
  })),
  checklists: (src.checklists ?? []).map((c: { items: (Ref & object)[] }) => ({
    ...c,
    items: c.items.map((i) => ({ ...quitar(i), ...resolver(i) }))
  }))
};
await writeFile(`${dir}/extras.json`, JSON.stringify(extras, null, 1));
console.log(`${id}: ${extras.glosario.length} términos, ${extras.frameworks.length} frameworks, ${extras.checklists.length} checklists`);
