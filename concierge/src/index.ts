// TextoVivo H-1 (concierge): un libro, una URL secreta por comprador, sin OAuth.
// Se descarta cuando arranca la V1.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import catalogoJson from "../data/catalogo.json" with { type: "json" };
import { api, adminEnvios } from "./api.ts";
import { buscadorD1 } from "./buscador-d1.ts";
import { Destilado } from "./schema.ts";
import {
  buscarConcepto,
  citarFuente,
  crearLibro,
  listarIndice,
  notaPaginas,
  obtenerChecklist,
  obtenerFramework
} from "./tools.ts";

const libros = catalogoJson.map((d) => crearLibro(Destilado.parse(d), buscadorD1(d.id, d.indice[0]?.titulo === "Preliminares" ? d.indice[0].pagina_fin + 1 : 1)));
const porId = new Map(libros.map((l) => [l.id, l]));
const IDIOMAS: Record<string, string> = { es: "español", en: "inglés", pt: "portugués", fr: "francés" };
const ahora = () => new Date().toISOString();

/** Libros que subieron autores y ya fueron aprobados (viven en D1, no en el catálogo del código). */
async function dinamico(id: string) {
  const r = await env.DB.prepare("SELECT * FROM libros_dyn WHERE id = ? AND visible = 1").bind(id).first<Record<string, string | number>>();
  if (!r) return null;
  const d = Destilado.parse({
    id: r.id, titulo: r.titulo, autor: r.autor, descripcion: r.descripcion, idioma: r.idioma === "otro" ? "es" : r.idioma,
    paginacion: r.paginacion, indice: JSON.parse(String(r.indice)), glosario: [], frameworks: [], checklists: []
  });
  return crearLibro(d, buscadorD1(d.id));
}
const resolver = async (id: string) => porId.get(id) ?? (await dinamico(id));
const noExiste = (id: string) => ({ mensaje: `No existe el libro «${id}». Usá listar_libros para ver los ids disponibles.` });
const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Verifica el acceso del comprador, ejecuta la herramienta y registra la llamada. */
async function usar(herramienta: string, consulta: string, ejecutar: () => unknown | Promise<unknown>) {
  const token = String(getMcpAuthContext()?.props.token ?? "");
  const comprador = await env.DB.prepare(
    `SELECT b.expires_at, b.calls, b.user_id, u.email_verificado_at
       FROM buyers b LEFT JOIN users u ON u.id = b.user_id WHERE b.token = ?`
  )
    .bind(token)
    .first<{ expires_at: string; calls: number; user_id: string | null; email_verificado_at: string | null }>();

  if (!comprador) return texto("Acceso no válido.");
  // Los accesos de cuentas nuevas solo funcionan con el email confirmado (los anteriores no tienen cuenta y siguen igual).
  if (comprador.user_id && !comprador.email_verificado_at)
    return texto(`Confirmá tu email para usar el conector: te mandamos un correo al crear la cuenta. Podés pedir otro en ${env.SITIO_URL}/mi-biblioteca.html`);
  if (comprador.expires_at <= ahora())
    return texto(
      `Tu acceso a TextoVivo venció el ${comprador.expires_at.slice(0, 10)}. Podés renovarlo en ${env.PUBLIC_URL}`
    );
  const limite = Number(env.CALLS_PER_TOKEN);
  if (comprador.calls >= limite)
    return texto(
      `Usaste las ${limite} consultas de este acceso. Podés renovarlo en ${env.PUBLIC_URL}`
    );

  const inicio = Date.now();
  const resultado = await ejecutar();
  const t = ahora();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE buyers SET calls = calls + 1, first_call_at = COALESCE(first_call_at, ?1), last_call_at = ?1 WHERE token = ?2"
    ).bind(t, token),
    env.DB.prepare(
      "INSERT INTO events (token, tool, query, latency_ms, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(token, herramienta, consulta.slice(0, 500), Date.now() - inicio, t)
  ]);
  return texto(JSON.stringify(resultado, null, 2));
}

function crearServidor() {
  const server = new McpServer({ name: "TextoVivo", version: "0.2.0" });
  const soloLectura = { readOnlyHint: true, openWorldHint: false };
  const libroId = z.string().min(2).max(80).describe("Id del libro (ver listar_libros)");

  server.registerTool(
    "listar_libros",
    {
      description:
        "Lista los libros de la biblioteca TextoVivo con su id, autor, idioma del texto y qué frameworks y checklists tienen. Usala primero para elegir el libro.",
      inputSchema: z.object({}),
      annotations: soloLectura
    },
    () =>
      usar("listar_libros", "", async () => {
        const { results } = await env.DB.prepare("SELECT id, titulo, autor, idioma, descripcion, tipo, paginacion FROM libros_dyn WHERE visible = 1 ORDER BY publicado_at DESC").all<Record<string, string>>();
        return [
          ...libros.map((l) => ({
            id: l.id,
            titulo: l.titulo,
            autor: l.autor,
            idioma: IDIOMAS[l.idioma] ?? l.idioma,
            paginas: notaPaginas(l),
            descripcion: l.descripcion,
            frameworks: l.frameworks.map((f) => f.nombre),
            checklists: l.checklists.map((c) => c.nombre)
          })),
          ...results.map((r) => ({
            id: r.id,
            titulo: r.titulo,
            autor: r.autor,
            tipo: r.tipo,
            idioma: IDIOMAS[r.idioma] ?? r.idioma,
            paginas: notaPaginas({ paginacion: r.paginacion as "logica" | "pdf" }),
            descripcion: r.descripcion,
            aporte_de_la_comunidad: true
          }))
        ];
      })
  );

  server.registerTool(
    "listar_indice",
    {
      description:
        "Muestra qué contiene un libro: capítulos con páginas y los nombres de sus frameworks, checklists y términos del glosario. El texto de cada libro está en su idioma original: escribí las búsquedas en ese idioma.",
      inputSchema: z.object({ libro: libroId }),
      annotations: soloLectura
    },
    ({ libro }) => usar("listar_indice", libro, async () => { const l = await resolver(libro); return l ? listarIndice(l) : noExiste(libro); })
  );

  server.registerTool(
    "buscar_concepto",
    {
      description:
        "Busca definiciones y pasajes en un libro. Devuelve texto literal con capítulo y página. Escribí la búsqueda en el idioma del libro.",
      inputSchema: z.object({
        libro: libroId,
        consulta: z.string().min(2).describe("Qué buscar, en palabras simples"),
        max_resultados: z.number().int().min(1).max(10).default(5)
      }),
      annotations: soloLectura
    },
    ({ libro, consulta, max_resultados }) =>
      usar("buscar_concepto", `${libro}: ${consulta}`, async () => { const l = await resolver(libro); return l ? buscarConcepto(l, consulta, max_resultados) : noExiste(libro); })
  );

  server.registerTool(
    "obtener_framework",
    {
      description:
        "Devuelve una metodología de un libro con sus pasos ordenados, la página y una cita literal de cada paso. Si hay varias posibles, devuelve sus nombres para elegir.",
      inputSchema: z.object({
        libro: libroId,
        nombre_o_tema: z.string().min(2).describe("Nombre del framework o tema que resuelve")
      }),
      annotations: soloLectura
    },
    ({ libro, nombre_o_tema }) =>
      usar("obtener_framework", `${libro}: ${nombre_o_tema}`, async () => { const l = await resolver(libro); return l ? obtenerFramework(l, nombre_o_tema) : noExiste(libro); })
  );

  server.registerTool(
    "obtener_checklist",
    {
      description:
        "Devuelve una lista de verificación de un libro para revisar un trabajo, con la página y la cita literal de cada punto.",
      inputSchema: z.object({ libro: libroId, tema: z.string().min(2).describe("Qué se quiere revisar") }),
      annotations: soloLectura
    },
    ({ libro, tema }) => usar("obtener_checklist", `${libro}: ${tema}`, async () => { const l = await resolver(libro); return l ? obtenerChecklist(l, tema) : noExiste(libro); })
  );

  server.registerTool(
    "citar_fuente",
    {
      description:
        "Encuentra en un libro la cita literal que respalda una afirmación o tema, con capítulo y página. La cita sale del texto del libro, nunca se inventa.",
      inputSchema: z.object({
        libro: libroId,
        afirmacion_o_tema: z.string().min(2).describe("Afirmación o tema a respaldar")
      }),
      annotations: soloLectura
    },
    ({ libro, afirmacion_o_tema }) =>
      usar("citar_fuente", `${libro}: ${afirmacion_o_tema}`, async () => { const l = await resolver(libro); return l ? citarFuente(l, afirmacion_o_tema) : noExiste(libro); })
  );

  return server;
}

// ponytail: sin allowedHostnames; alcanza para localhost y *.workers.dev.
// Con dominio propio, pasar { allowedHostnames: ["tu-dominio"] }.
const mcp = createMcpHandler(crearServidor);
const RUTA_MCP = /^\/c\/([a-f0-9]{32})\/mcp$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

async function esAdmin(req: Request) {
  const enviado = new TextEncoder().encode(req.headers.get("authorization") ?? "");
  const esperado = new TextEncoder().encode(`Bearer ${env.ADMIN_SECRET}`);
  return (
    Boolean(env.ADMIN_SECRET) &&
    enviado.byteLength === esperado.byteLength &&
    crypto.subtle.timingSafeEqual(enviado, esperado)
  );
}

async function admin(req: Request, url: URL) {
  if (!(await esAdmin(req))) return json({ error: "No autorizado" }, 401);
  if (url.pathname.startsWith("/admin/envios")) return adminEnvios(req, url);

  // Alta de un comprador después de que llega el pago de Wompi.
  if (req.method === "POST" && url.pathname === "/admin/compradores") {
    const { email, es_prueba } = (await req.json().catch(() => ({}))) as {
      email?: string;
      es_prueba?: boolean;
    };
    if (!email?.includes("@")) return json({ error: "Falta un email válido" }, 400);

    const token = crypto.randomUUID().replaceAll("-", "");
    const creado = new Date();
    const vence = new Date(creado.getTime() + Number(env.RENTAL_DAYS) * 86_400_000);
    await env.DB.prepare(
      "INSERT INTO buyers (token, email, es_prueba, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(token, email, es_prueba ? 1 : 0, creado.toISOString(), vence.toISOString())
      .run();

    return json({
      email,
      url_mcp: `${url.origin}/c/${token}/mcp`,
      guia_personal: `${url.origin}/guia#${token}`,
      vence: vence.toISOString()
    });
  }

  // Métricas contra las metas del H-1.
  if (req.method === "GET" && url.pathname === "/admin/metricas") {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS compradores,
              COALESCE(SUM(first_call_at IS NOT NULL), 0) AS activados,
              COALESCE(SUM(first_call_at IS NOT NULL AND julianday(first_call_at) - julianday(created_at) <= 1), 0) AS activados_24h,
              COALESCE(SUM(calls >= 5), 0) AS con_5_o_mas,
              COALESCE(SUM(calls), 0) AS llamadas
         FROM buyers WHERE es_prueba = 0`
    ).first<Record<string, number>>();
    const porHerramienta = await env.DB.prepare(
      `SELECT e.tool AS herramienta, COUNT(*) AS llamadas
         FROM events e JOIN buyers b ON b.token = e.token
        WHERE b.es_prueba = 0 GROUP BY e.tool ORDER BY llamadas DESC`
    ).all();
    const detalle = await env.DB.prepare(
      "SELECT email, created_at, first_call_at, calls, expires_at FROM buyers WHERE es_prueba = 0 ORDER BY created_at DESC"
    ).all();

    const n = r?.compradores ?? 0;
    const pct = (x = 0) => (n ? Math.round((x / n) * 100) : 0);
    return json({
      metas: { alquileres: 30, activacion_24h_pct: 80, con_5_o_mas_pct: 50 },
      actual: {
        alquileres: n,
        activacion_24h_pct: pct(r?.activados_24h),
        con_5_o_mas_pct: pct(r?.con_5_o_mas),
        activados_total: r?.activados ?? 0,
        llamadas: r?.llamadas ?? 0
      },
      por_herramienta: porHerramienta.results,
      compradores: detalle.results
    });
  }

  return json({ error: "No encontrado" }, 404);
}

export default {
  async fetch(req, _env, ctx) {
    const url = new URL(req.url);

    const ruta = url.pathname.match(RUTA_MCP);
    if (ruta) {
      const token = ruta[1];
      const existe = await env.DB.prepare("SELECT 1 FROM buyers WHERE token = ?").bind(token).first();
      if (!existe) return new Response("No encontrado", { status: 404 });

      // El handler sirve /mcp y lee el token desde ctx.props (getMcpAuthContext).
      url.pathname = "/mcp";
      const ctxConToken = {
        waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
        passThroughOnException: () => ctx.passThroughOnException(),
        props: { token }
      } as unknown as ExecutionContext;
      return mcp(new Request(url, req), env, ctxConToken);
    }

    if (url.pathname.startsWith("/api/")) return api(req, url);
    if (url.pathname.startsWith("/admin/")) return admin(req, url);
    return new Response("No encontrado", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
