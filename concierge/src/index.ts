// TextoVivo H-1 (concierge): un libro, una URL secreta por comprador, sin OAuth.
// Se descarta cuando arranca la V1.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import catalogoJson from "../data/catalogo.json" with { type: "json" };
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
const ids = libros.map((l) => l.id) as [string, ...string[]];
const IDIOMAS: Record<string, string> = { es: "español", en: "inglés", pt: "portugués", fr: "francés" };
const ahora = () => new Date().toISOString();
const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Verifica el acceso del comprador, ejecuta la herramienta y registra la llamada. */
async function usar(herramienta: string, consulta: string, ejecutar: () => unknown | Promise<unknown>) {
  const token = String(getMcpAuthContext()?.props.token ?? "");
  const comprador = await env.DB.prepare("SELECT expires_at, calls FROM buyers WHERE token = ?")
    .bind(token)
    .first<{ expires_at: string; calls: number }>();

  if (!comprador) return texto("Acceso no válido.");
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
  const libroId = z.enum(ids).describe("Id del libro (ver listar_libros)");
  const con = (id: string) => porId.get(id)!;

  server.registerTool(
    "listar_libros",
    {
      description:
        "Lista los libros de la biblioteca TextoVivo con su id, autor, idioma del texto y qué frameworks y checklists tienen. Usala primero para elegir el libro.",
      inputSchema: z.object({}),
      annotations: soloLectura
    },
    () =>
      usar("listar_libros", "", () =>
        libros.map((l) => ({
          id: l.id,
          titulo: l.titulo,
          autor: l.autor,
          idioma: IDIOMAS[l.idioma] ?? l.idioma,
          paginas: notaPaginas(l),
          descripcion: l.descripcion,
          frameworks: l.frameworks.map((f) => f.nombre),
          checklists: l.checklists.map((c) => c.nombre)
        }))
      )
  );

  server.registerTool(
    "listar_indice",
    {
      description:
        "Muestra qué contiene un libro: capítulos con páginas y los nombres de sus frameworks, checklists y términos del glosario. El texto de cada libro está en su idioma original: escribí las búsquedas en ese idioma.",
      inputSchema: z.object({ libro: libroId }),
      annotations: soloLectura
    },
    ({ libro }) => usar("listar_indice", libro, () => listarIndice(con(libro)))
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
      usar("buscar_concepto", `${libro}: ${consulta}`, () => buscarConcepto(con(libro), consulta, max_resultados))
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
      usar("obtener_framework", `${libro}: ${nombre_o_tema}`, () => obtenerFramework(con(libro), nombre_o_tema))
  );

  server.registerTool(
    "obtener_checklist",
    {
      description:
        "Devuelve una lista de verificación de un libro para revisar un trabajo, con la página y la cita literal de cada punto.",
      inputSchema: z.object({ libro: libroId, tema: z.string().min(2).describe("Qué se quiere revisar") }),
      annotations: soloLectura
    },
    ({ libro, tema }) => usar("obtener_checklist", `${libro}: ${tema}`, () => obtenerChecklist(con(libro), tema))
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
      usar("citar_fuente", `${libro}: ${afirmacion_o_tema}`, () => citarFuente(con(libro), afirmacion_o_tema))
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

    if (url.pathname === "/acceso" && req.method === "POST" && env.ACCESO_GRATIS === "1") {
      const form = await req.formData().catch(() => new FormData());
      const email = String(form.get("email") ?? "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return new Response(null, { status: 303, headers: { location: "/entrar.html?error=email" } });
      // Mismo email con acceso vigente: reusa el token.
      const previo = await env.DB.prepare(
        "SELECT token FROM buyers WHERE email = ? AND es_prueba = 0 AND expires_at > ? ORDER BY created_at DESC"
      )
        .bind(email, new Date().toISOString())
        .first<{ token: string }>();
      let token = previo?.token;
      if (!token) {
        token = crypto.randomUUID().replaceAll("-", "");
        const creado = new Date();
        const vence = new Date(creado.getTime() + Number(env.RENTAL_DAYS) * 86_400_000);
        await env.DB.prepare("INSERT INTO buyers (token, email, es_prueba, created_at, expires_at) VALUES (?, ?, 0, ?, ?)")
          .bind(token, email, creado.toISOString(), vence.toISOString())
          .run();
      }
      return new Response(null, { status: 303, headers: { location: `/guia.html#${token}`, "referrer-policy": "no-referrer" } });
    }

    // Datos del acceso para «Mi biblioteca». El token va en el header, nunca en la URL.
    if (url.pathname === "/api/acceso" && req.method === "GET") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const c = /^[a-f0-9]{32}$/.test(token)
        ? await env.DB.prepare("SELECT email, created_at, expires_at, calls, last_call_at FROM buyers WHERE token = ?")
            .bind(token)
            .first<{ email: string; created_at: string; expires_at: string; calls: number; last_call_at: string | null }>()
        : null;
      if (!c) return json({ error: "Acceso no válido" }, 401);
      const dias = Math.ceil((new Date(c.expires_at).getTime() - Date.now()) / 86_400_000);
      return json({
        email: c.email,
        url_mcp: `${url.origin}/c/${token}/mcp`,
        vence: c.expires_at,
        dias_restantes: Math.max(0, dias),
        vencido: c.expires_at <= ahora(),
        consultas_usadas: c.calls,
        consultas_limite: Number(env.CALLS_PER_TOKEN),
        ultima_consulta: c.last_call_at,
        libros: libros.map((l) => ({ id: l.id, titulo: l.titulo, autor: l.autor }))
      });
    }
    if (url.pathname.startsWith("/admin/")) return admin(req, url);
    return new Response("No encontrado", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
