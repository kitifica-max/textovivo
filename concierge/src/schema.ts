// Formato de los datos de un Texto Vivo destilado a mano para el H-1.
// destilado.json lo arma una persona (con ayuda de Claude); paginas.json sale del PDF.
import { z } from "zod";

const Pagina = z.number().int().min(1);
// Cita literal corta: tiene que existir tal cual en el texto de esa página (lo valida npm test).
const Cita = z.string().min(3).max(400);

export const Destilado = z.object({
  id: z.string(),
  titulo: z.string(),
  autor: z.string(),
  descripcion: z.string().default(""),
  idioma: z.string().default("es"),
  // «logica»: páginas del texto digital (~1.500 caracteres), NO las del libro impreso. «aforismo»: el número del aforismo.
  paginacion: z.enum(["logica", "aforismo", "pdf"]).default("logica"),
  indice: z.array(
    z.object({
      titulo: z.string(),
      nivel: z.number().int().min(1),
      pagina_inicio: Pagina,
      pagina_fin: Pagina
    })
  ),
  glosario: z.array(
    z.object({
      termino: z.string(),
      definicion: z.string(),
      pagina: Pagina,
      cita: Cita
    })
  ),
  frameworks: z.array(
    z.object({
      nombre: z.string(),
      resumen: z.string(),
      verificado: z.boolean().default(false),
      pasos: z
        .array(
          z.object({
            orden: z.number().int(),
            titulo: z.string(),
            descripcion: z.string(),
            pagina: Pagina,
            cita: Cita
          })
        )
        .min(1)
    })
  ),
  checklists: z.array(
    z.object({
      nombre: z.string(),
      contexto: z.string(),
      verificado: z.boolean().default(false),
      items: z
        .array(z.object({ texto: z.string(), pagina: Pagina, cita: Cita }))
        .min(1)
    })
  )
});
export type Destilado = z.infer<typeof Destilado>;

export const Paginas = z.array(z.object({ pagina: Pagina, texto: z.string() }));
export type Paginas = z.infer<typeof Paginas>;
