# Textifika

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

## Arquitectura de despliegue (Netlify + Cloudflare)

El DNS de `kitifica.com` está en Netlify, y Cloudflare solo permite dominio propio en un Worker si la zona está en Cloudflare. Por eso:

- **Sitio (frontend):** `diseno/` se publica en Netlify (`netlify.toml`), en `textifika.kitifica.com`.
- **Backend:** el Worker `textovivo` en Cloudflare (D1, R2, MCP). Netlify le reenvía `/api/*` y `/admin/*` (proxy con estado 200), así que el navegador ve todo en un solo dominio y la cookie de sesión es propia del sitio.
- **Conector MCP:** la dirección que se le da al lector sigue siendo la del Worker (`https://textovivo.kitifica.workers.dev/c/<token>/mcp`), sin pasar por Netlify.
- **Origen permitido:** `ORIGENES_PERMITIDOS` en `concierge/wrangler.jsonc` lista los sitios que pueden llamar a la API con cookie.
- **Turnstile:** el hostname de Netlify tiene que estar en los *Hostnames* del widget.
- **Cambios del sitio:** `git push` → Netlify publica. **Cambios del backend:** `cd concierge && npm run deploy`.
