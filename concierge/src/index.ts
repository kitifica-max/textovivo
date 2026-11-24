// TextoVivo H-1 (concierge): un libro, una URL secreta por comprador, sin OAuth.
// Se descarta cuando arranca la V1.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import destiladoJson from "../data/destilado.json" with { type: "json" };
import paginasJson from "../data/paginas.json" with { type: "json" };
import { guia, landing } from "./pages.ts";
import { Destilado, Paginas } from "./schema.ts";
import {
  buscarConcepto,
  citarFuente,
  crearLibro,
  listarIndice,
  obtenerChecklist,
  obtenerFramework
} from "./tools.ts";

const libro = crearLibro(Destilado.parse(destiladoJson), Paginas.parse(paginasJson));
const ahora = () => new Date().toISOString();
const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Verifica el acceso del comprador, ejecuta la herramienta y registra la llamada. */
async function usar(herramienta: string, consulta: string, ejecutar: () => unknown) {
  const token = String(getMcpAuthContext()?.props.token ?? "");
  const comprador = await env.DB.prepare("SELECT expires_at, calls FROM buyers WHERE token = ?")
    .bind(token)
    .first<{ expires_at: string; calls: number }>();

  if (!comprador) return texto("Acceso no válido.");
  if (comprador.expires_at <= ahora())
    return texto(
      `Tu acceso a «${libro.titulo}» venció el ${comprador.expires_at.slice(0, 10)}. Podés renovarlo en ${env.PUBLIC_URL}`
    );
  const limite = Number(env.CALLS_PER_TOKEN);
  if (comprador.calls >= limite)
    return texto(
      `Usaste las ${limite} consultas de este alquiler de «${libro.titulo}». Podés renovarlo en ${env.PUBLIC_URL}`
    );

  const inicio = Date.now();
  const resultado = ejecutar();
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
  const server = new McpServer({ name: "TextoVivo", version: "0.1.0" });
  const idiomas: Record<string, string> = { en: "inglés", pt: "portugués", fr: "francés" };
  const aviso = idiomas[libro.idioma] ? ` (el texto está en ${idiomas[libro.idioma]}: escribí las búsquedas en ${idiomas[libro.idioma]})` : "";
  const obra = `«${libro.titulo}» de ${libro.autor}${aviso}`;
  const soloLectura = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "listar_indice",
    {
      description: `Muestra qué contiene el libro ${obra}: capítulos con páginas y los nombres de sus frameworks, checklists y términos del glosario. Usala primero para orientarte.`,
      inputSchema: z.object({}),
      annotations: soloLectura
    },
    () => usar("listar_indice", "", () => listarIndice(libro))
  );

  server.registerTool(
    "buscar_concepto",
    {
      description: `Busca definiciones y pasajes en ${obra}. Devuelve texto literal del libro con capítulo y páginas.`,
      inputSchema: z.object({
        consulta: z.string().min(2).describe("Qué buscar, en palabras simples"),
        max_resultados: z.number().int().min(1).max(10).default(5)
      }),
      annotations: soloLectura
    },
    ({ consulta, max_resultados }) =>
      usar("buscar_concepto", consulta, () => buscarConcepto(libro, consulta, max_resultados))
  );

  server.registerTool(
    "obtener_framework",
    {
      description: `Devuelve una metodología de ${obra} con sus pasos ordenados, la página y una cita literal de cada paso. Si hay varias posibles, devuelve sus nombres para elegir.`,
      inputSchema: z.object({
        nombre_o_tema: z.string().min(2).describe("Nombre del framework o tema que resuelve")
      }),
      annotations: soloLectura
    },
    ({ nombre_o_tema }) =>
      usar("obtener_framework", nombre_o_tema, () => obtenerFramework(libro, nombre_o_tema))
  );

  server.registerTool(
    "obtener_checklist",
    {
      description: `Devuelve una lista de verificación de ${obra} para revisar un trabajo, con la página y la cita literal de cada punto.`,
      inputSchema: z.object({ tema: z.string().min(2).describe("Qué se quiere revisar") }),
      annotations: soloLectura
    },
    ({ tema }) => usar("obtener_checklist", tema, () => obtenerChecklist(libro, tema))
  );

  server.registerTool(
    "citar_fuente",
    {
      description: `Encuentra en ${obra} la cita literal que respalda una afirmación o tema, con capítulo y página. La cita sale del texto del libro, nunca se inventa.`,
      inputSchema: z.object({
        afirmacion_o_tema: z.string().min(2).describe("Afirmación o tema a respaldar")
      }),
      annotations: soloLectura
    },
    ({ afirmacion_o_tema }) =>
      usar("citar_fuente", afirmacion_o_tema, () => citarFuente(libro, afirmacion_o_tema))
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

const html = (cuerpo: string) =>
  new Response(cuerpo, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
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
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return new Response("Email inválido", { status: 400 });
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
      return new Response(null, { status: 303, headers: { location: `/guia#${token}`, "referrer-policy": "no-referrer" } });
    }

    if (url.pathname === "/" && req.method === "GET") return html(landing(libro, env));
    if (url.pathname === "/guia" && req.method === "GET") return html(guia(libro));
    if (url.pathname.startsWith("/admin/")) return admin(req, url);
    return new Response("No encontrado", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
