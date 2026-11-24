# TextoVivo

Lo mejor de cada libro, dentro de tu IA. Un lector alquila un libro por 30 días y lo conecta a Claude, Claude Code o Cursor (MCP). Su IA aplica los frameworks y checklists del libro y cita la página exacta.

## Qué hay en este repo

| Carpeta / archivo | Qué es |
|---|---|
| [`TEXTOVIVO-SPEC-V1.md`](TEXTOVIVO-SPEC-V1.md) | Especificación de la V1 (Cloudflare, Wompi 3DS, hitos H-1 a H8) |
| [`concierge/`](concierge/README.md) | H-1: Worker de validación en Cloudflare (MCP por URL secreta + D1), con *El arte de la guerra* cargado |
| [`diseno/`](diseno/README.md) | El sitio (HTML y CSS): portada, biblioteca, fichas de libro, entrar, guía de conexión, mi biblioteca, autores. Se sirve desde el mismo Worker que el backend · en vivo: https://textovivo.kitifica.workers.dev |
| `concepto_de_producto_vivotext_textos_vivos.md` | Documento de concepto original |

## Correr en local

```bash
# Sitio + backend juntos (http://localhost:8787)
# Concierge (H-1)
cd concierge && npm install && cp .dev.vars.example .dev.vars && npm run db:local && npm run dev
```

Los secretos (`.dev.vars`, `.secreto-admin`) no se suben al repo.

## Despliegue

Un solo Worker de Cloudflare (`textovivo`) sirve el sitio (`diseno/`, como assets) y el backend (`concierge/`: `/acceso`, `/api/acceso`, `/c/<token>/mcp`, `/admin/*`; los textos están en D1).

```bash
cd concierge
node scripts/catalogo.ts && node scripts/sitio.ts   # valida los libros y regenera catálogo y fichas
npx wrangler deploy
```

GitHub Pages (`redirect/`) solo redirige a ese sitio.
