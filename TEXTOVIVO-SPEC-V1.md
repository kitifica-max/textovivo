# TextoVivo: especificación V1 (Cloudflare)

> Documento de arranque para construir la V1 de TextoVivo con Claude Code, con todo el backend en Cloudflare.
> Reemplaza a la "especificación del MVP" anterior. Describe qué construir, en qué orden y con qué criterios de aceptación.
> Donde dice **[verificar]**, consultar la documentación oficial vigente de Cloudflare, de MCP o del cliente de IA antes de implementar.
> Donde dice **[preguntar]**, la decisión es del dueño del producto: no implementar sin respuesta.

---

## 0. Instrucciones para Claude Code

- Construye por hitos (sección 12), en orden. No empieces un hito sin que el anterior cumpla sus criterios de aceptación.
- **El hito H-1 (validación concierge) va antes que todo.** Si no cumple sus metas, no se construye la V1.
- Al terminar cada hito, resume qué hiciste, qué quedó pendiente y cómo probarlo.
- Pregunta antes de: cambiar el proveedor de pagos (Wompi), añadir otro servicio externo de pago, cambiar el esquema de base de datos de un hito ya cerrado, o tomar una decisión que contradiga este documento.
- Antes de usar una API de Cloudflare (Agents SDK, Workflows, Vectorize, D1, `workers-oauth-provider`) o de un cliente de IA (conectores de Claude, links de instalación de Cursor), revisa su documentación actual: cambian con frecuencia.
- Prioriza código simple y legible sobre abstracciones. Es una V1.
- Todo texto visible para el usuario va en español.
- Nunca guardes claves en el código: usa secretos de Wrangler (`wrangler secret put`) y mantén un `.dev.vars.example` actualizado.

---

## 1. Qué es TextoVivo V1

TextoVivo permite que **autores e investigadores publiquen su conocimiento como Textos Vivos** y que **cualquier persona alquile el acceso por 30 días** para usarlo dentro de la IA que ya usa (Claude, Claude Code, Cursor).

El lector **no sale de su IA**: conecta TextoVivo una sola vez como conector (MCP remoto), inicia sesión con su cuenta, y su IA puede consultar los Textos Vivos que tiene alquilados. Sin PWA, sin chat propio, sin app que abrir.

**Promesa para el lector:** "El conocimiento correcto + tu IA = mejores ideas, mejores contextos y mejores herramientas."

**Promesa para el autor:** "Publicá tu libro o tu investigación en TextoVivo y cobrá cada vez que alguien lo alquila."

**Diferenciador:** no es un buscador de fragmentos. La destilación extrae **frameworks, checklists y glosario** con cita literal y página verificada, y la IA del lector los consulta como herramientas. Posicionamiento: *"Context7, pero para conocimiento experto."*

**Nombres:** la marca es **TextoVivo**. En la interfaz, cada producto se presenta como **«libro»** (por ejemplo, «Alquilá un libro»). «Texto Vivo» queda como término interno para el libro preparado (tablas, código y esta spec).

---

## 2. Decisiones ya tomadas

| Decisión | Elección |
|---|---|
| Entrega | Servidor MCP remoto alojado en Cloudflare. **Un solo conector por lector** (biblioteca) |
| Interfaz del lector | **Solo su propia IA** vía conector. Sin PWA ni chat propio |
| Web de TextoVivo | Solo para: página pública de cada Texto Vivo, comprar, guía de conexión, paneles |
| Público lector | Builders: personas que crean con IA a diario (Claude, Claude Code, Cursor) |
| Público autor | Autores e investigadores de contenido práctico para builders (diseño, producto, UX, copy, marketing). **Por invitación** en V1 |
| Modelo de cobro | **Alquiler de 30 días por Texto Vivo**, pago único (sin renovación automática) |
| Precio | US$4.99 por Texto Vivo por 30 días (configurable) |
| Reparto | 60 % autor / 40 % TextoVivo sobre el precio bruto. TextoVivo absorbe comisiones de pago (configurable) |
| Pagos | **Wompi (El Salvador)**: transacción de compra con **3DS** por API (`POST /TransaccionCompra/3DS`) + webhook firmado |
| Liquidación a autores | Manual, una vez al mes, con reporte exportable. **Solo se liquidan alquileres con pago aprobado y ya acreditado por Wompi** |
| Despublicar o borrar | Sin reembolsos: los alquileres activos se respetan hasta vencer y se liquidan al autor |
| Costo de LLM por consulta | US$0 para TextoVivo: la IA la pone el lector |
| Infraestructura | Cloudflare (Workers, D1, R2, Workflows, KV; Vectorize y Workers AI si hacen falta) |
| Idioma de la interfaz | Español |

---

## 3. Alcance de la V1

### Dentro
1. Cuentas con roles: **lector**, **autor**, **admin**. Login con Google y enlace mágico por email.
2. Autor (invitado por admin): sube un archivo **PDF, EPUB o Markdown**.
3. Pipeline de destilación en segundo plano, con progreso visible.
4. Pantalla de revisión del autor: ver, editar, eliminar y marcar como verificado frameworks, checklists y términos.
5. Publicar el Texto Vivo: genera su **página pública** (`/t/{slug}`) con descripción, índice, ejemplo antes/después y botón "Alquilar 30 días".
6. Compra del alquiler con formulario de tarjeta propio + transacción 3DS de Wompi; el webhook activa el alquiler.
7. **Conector biblioteca**: un solo endpoint MCP con OAuth. Al iniciar sesión, el lector ve en su IA todos sus Textos Vivos con alquiler activo.
8. Verificación de alquiler en **cada** llamada de herramienta. Si venció, la herramienta responde con un mensaje claro y el link para renovar.
9. Guía de conexión paso a paso para **Claude (web/escritorio)**, **Claude Code** y **Cursor**.
10. Panel del lector: alquileres activos y vencidos, días restantes, consultas usadas, renovar, revocar conexiones.
11. Panel del autor: sus Textos Vivos, estado, alquileres, consultas, ganancias del mes.
12. Panel admin mínimo: invitar autores, ver ventas, exportar liquidación mensual (CSV), marcar liquidación pagada.
13. Límites de uso por alquiler y protección contra extracción masiva.
14. Emails: enlace mágico, compra confirmada (con guía), aviso de vencimiento, destilación lista (autor).
15. Despublicar un Texto Vivo corta las ventas nuevas; los alquileres activos siguen hasta vencer. Borrarlo elimina todo lo asociado (R2, D1, Vectorize); si tiene alquileres activos, queda despublicado y se borra automáticamente cuando vence el último.

### Fuera (no construir todavía)
- PWA, app móvil o chat propio.
- Cobro por llamada a builders (licencia comercial, `paidTool`, x402). Es la fase 2 (sección 14).
- Liquidación automática a autores.
- Registro público de autores (en V1 entran por invitación).
- Precio definido por cada autor.
- Suscripción con renovación automática.
- Soporte de ChatGPT (sus conectores MCP personalizados son solo para planes Business/Enterprise/Edu con admin **[verificar]**).
- Equipos, compartir, regalos.
- DOCX, OCR de escaneados, edición del texto fuente.
- Paquete local (SQLite) descargable.
- Landing de marketing (aparte). La V1 solo necesita portada mínima y páginas públicas de Textos Vivos.

---

## 4. Flujos

### 4.1 Autor
1. Recibe invitación por email y crea su cuenta.
2. Sube un archivo; puede añadir título, autor y descripción corta.
3. Ve el progreso: *Leyendo → Detectando capítulos → Indexando → Extrayendo frameworks y checklists → Listo para revisar*. Recibe email al terminar.
4. Revisa: índice, glosario, frameworks y checklists con su referencia (capítulo y página). Edita, elimina o marca como verificado.
5. Acepta los términos de publicación (declara tener los derechos digitales) y pulsa **Publicar**.
6. Comparte el link de su página pública con su audiencia.

### 4.2 Lector
1. Llega a la página pública de un Texto Vivo (`/t/{slug}`).
2. Pulsa **Alquilar 30 días** → inicia sesión (Google o enlace mágico) → completa el formulario de pago de TextoVivo → su banco le pide la verificación 3DS → vuelve a TextoVivo.
3. El webhook activa el alquiler. Ve la pantalla "Listo" con **su URL de conexión** y la guía para su cliente.
4. Si es su primer alquiler, conecta TextoVivo en su IA (una sola vez en la vida):
   - **Claude:** botón "Abrir Conectores de Claude" (`https://claude.ai/customize/connectors`) + botón "Copiar URL" + 6 pasos con capturas y video de 45 s.
   - **Claude Code:** un comando para copiar: `claude mcp add --transport http textovivo https://{dominio}/mcp`.
   - **Cursor:** botón de instalación en un clic **[verificar formato del link de instalación MCP]**.
5. Inicia sesión en TextoVivo desde la pantalla de autorización y aprueba.
6. Usa su IA. Cada nuevo alquiler aparece automáticamente en el mismo conector, sin volver a configurar nada.
7. Recibe un aviso 3 días antes de vencer y otro al vencer, con link para renovar.

### 4.3 Admin (Kitifica)
1. Invita autores.
2. Revisa ventas y uso.
3. A fin de mes exporta el CSV de liquidación, paga a cada autor por fuera y marca la liquidación como pagada.

---

## 5. Arquitectura en Cloudflare

Un solo proyecto con Wrangler. Un Worker principal sirve la web, la API y el endpoint MCP.

### Stack

| Capa | Tecnología | Notas |
|---|---|---|
| Runtime | **Cloudflare Workers** + TypeScript | Configuración en `wrangler.jsonc` |
| API HTTP | **Hono** | Rutas `/api/*`, webhooks en `/webhooks/*` |
| Frontend | **React + Vite + Tailwind + shadcn/ui**, servido como assets estáticos del Worker | Páginas: portada, página pública de Texto Vivo, compra, guía de conexión, paneles (lector, autor, admin), revisión |
| Servidor MCP | **Agents SDK de Cloudflare: `createMcpHandler`** (`agents/mcp/server`) con MCP SDK v2 (`@modelcontextprotocol/server`, versión exacta que pide `agents`). Sin estado, sin Durable Objects. Requiere `nodejs_compat` | Un solo endpoint `/mcp`. `McpAgent` está **deprecado**: no usarlo (verificado en `agents` 0.34) |
| OAuth para MCP | **`@cloudflare/workers-oauth-provider`** | Envuelve el Worker; usa KV. Soportar registro dinámico de clientes (DCR) y, si es posible, Client ID Metadata Document (CIMD), que Claude recomienda **[verificar]** |
| Login de la app | Google OAuth + enlace mágico, sesiones propias en D1 | Evaluar Better Auth sobre D1 si simplifica **[verificar]** |
| Base de datos | **D1** (SQLite) | Migraciones con `wrangler d1 migrations` |
| Búsqueda por palabras | **FTS5** en D1 | **[verificar]** soporte actual de FTS5 en D1 |
| Búsqueda semántica | **Vectorize** + **Workers AI** (`@cf/baai/bge-m3`, 1024 dims) | **Solo si en H2 FTS5 no alcanza** (ver sección 7) |
| Archivos | **R2** | Originales e intermedios del pipeline |
| Jobs largos | **Workflows** | `DistillationWorkflow` con pasos reintentables |
| LLM de destilación | **Claude API** (`claude-sonnet-5-5` para extracción; `claude-haiku-5-5` para tareas baratas) vía **AI Gateway** | Costo estimado < US$2 por libro de 300 páginas; medir en H3 |
| Pagos | **Wompi El Salvador**: transacción 3DS por API + webhook (`https://api.wompi.sv`) | Ver sección 9. Implica manejar datos de tarjeta: ver 9.1 |
| Email | Resend (por `fetch`) | |
| Respaldo para PDFs difíciles | Cloudflare Containers con PyMuPDF | Solo si `unpdf` no alcanza (decidir en H2) |

### Bindings (`wrangler.jsonc`)

| Binding | Tipo | Uso |
|---|---|---|
| `DB` | D1 | Datos de la app |
| `FILES` | R2 | Archivos originales e intermedios |
| `DISTILL_WORKFLOW` | Workflow | Pipeline de destilación |
| `OAUTH_KV` | KV | Estado de `workers-oauth-provider` |
| `ASSETS` | Static assets | Frontend |
| `VECTORIZE` | Vectorize | Solo si se decide en H2 |
| `AI` | Workers AI | Solo si se decide en H2 |

Secretos: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `SESSION_SECRET`, `AI_GATEWAY_ID`, `WOMPI_APP_ID` (client_id), `WOMPI_API_SECRET` (client_secret y llave HMAC del webhook).

Variables (no secretas, en `wrangler.jsonc`): `RENTAL_PRICE_CENTS=499`, `RENTAL_DAYS=30`, `AUTHOR_SHARE_PCT=60`, `CALLS_PER_RENTAL=150`, `CALLS_PER_MINUTE=20`, `SETTLEMENT_DAYS=7` (días hasta considerar acreditado un pago; ajustar al plazo real de Wompi), `WOMPI_ALLOW_TEST_PAYMENTS` (`true` solo en desarrollo).

### Diagrama lógico

```
Autor (navegador)                         Lector (navegador)
   │ subir / revisar / publicar              │ página pública / pagar / guía
   ▼                                         ▼
Worker (Hono + assets React) ──► R2      Worker ──3DS──► Wompi ──webhook──► Worker ──► D1 (rentals)
   │
   ├──► Workflow DistillationWorkflow
   │        ├─► Claude API (vía AI Gateway)
   │        ├─► (opcional) Workers AI ──► Vectorize
   │        └─► D1 (secciones, chunks, FTS5, frameworks, checklists, glosario)
   │
   ▼
workers-oauth-provider ──► createMcpHandler (sin estado)  /mcp
   ▲                              │ verifica alquiler en D1 en cada llamada
   │  Streamable HTTP + OAuth     │ consulta D1 (+ Vectorize)
IA del lector (Claude, Claude Code, Cursor)
```

### Estructura de carpetas sugerida

```
/src
  index.ts              # entrada: workers-oauth-provider + Hono + createMcpHandler
  api/                  # rutas Hono
  auth/                 # login de la app y pantalla de autorización OAuth
  payments/             # Wompi: token, transacción 3DS, webhook, consulta de transacción
  rentals/              # activar, extender, verificar, cuotas
  mcp/                  # servidor MCP (factory por request) y herramientas
  workflows/            # DistillationWorkflow y etapas
  search/               # búsqueda (FTS5, y Vectorize + RRF si aplica)
  db/                   # consultas D1 y tipos
/web                    # frontend React + Vite
/migrations             # migraciones D1
/prompts                # prompts de destilación versionados
/fixtures               # documentos de prueba
/concierge              # H-1: Worker mínimo de validación (se descarta después)
```

---

## 6. Modelo de datos (D1)

Nombres en inglés en el código; comentarios en español. Campos JSON como `TEXT` con JSON válido. IDs con `crypto.randomUUID()`. Montos en centavos de USD (enteros).

```
users
  id, email, name, created_at
  role: 'reader' | 'author' | 'admin'      -- un autor también puede alquilar

sessions
  id, user_id, expires_at, created_at

author_invites
  id, email, token, invited_by, created_at, accepted_at

textos_vivos
  id, author_id, title, author_name, description, language
  status: 'uploaded' | 'processing' | 'review' | 'published' | 'unpublished' | 'failed' | 'deleted'
  public_slug (único, legible: p. ej. 'refactoring-ui-wathan')
  source_key (R2), source_format ('pdf' | 'epub' | 'md'), page_count
  price_cents (por defecto RENTAL_PRICE_CENTS)
  workflow_instance_id, error_message
  created_at, published_at
  delete_source_after_processing (bool, por defecto 1)
  terms_accepted_at                         -- autor declaró derechos al publicar
  delete_requested_at                       -- borrado pedido con alquileres activos; el Cron lo ejecuta al vencer el último

sections
  id, texto_id, parent_id, title, level, order_index, page_start, page_end

chunks
  id, texto_id, section_id, content, page_start, page_end, token_count

chunks_fts                    -- tabla virtual FTS5 sobre chunks.content
  (content, texto_id UNINDEXED, chunk_id UNINDEXED)

frameworks
  id, texto_id, section_id, name, summary
  steps (JSON: [{order, title, description, source: {page, quote}}])
  verified, edited_by_user

checklists
  id, texto_id, section_id, name, context
  items (JSON: [{text, source: {page, quote}}])
  verified, edited_by_user

glossary_terms
  id, texto_id, term, definition, page, quote

processing_jobs
  id, texto_id, stage, progress (0-100), started_at, finished_at, error

purchase_intents                            -- una por intento de pago
  id                                        -- también va en datosAdicionales de Wompi
  user_id, texto_id, amount_cents
  wompi_transaction_id (único)              -- idTransaccion que devuelve POST /TransaccionCompra/3DS
  status: 'pending' | 'paid' | 'failed' | 'expired'
  created_at, paid_at
  -- NUNCA guardar aquí ni en ninguna tabla: número de tarjeta, CVV, vencimiento

rentals
  id, user_id, texto_id, purchase_intent_id
  status: 'active' | 'expired' | 'refunded'
  starts_at, expires_at
  calls_used, calls_limit                   -- cuota por alquiler
  amount_cents, author_share_cents          -- congelados al momento de la compra
  payment_provider ('wompi'), payment_ref (único) -- IdTransaccion de Wompi; idempotencia del webhook
  paid_at                                   -- FechaTransaccion del webhook
  payout_id                                 -- null hasta que se incluye en una liquidación
  created_at

usage_events
  id, user_id, texto_id, rental_id, tool_name, created_at, latency_ms
  query_text                                 -- se borra a los 30 días; nunca se muestra al autor

payouts
  id, author_id, period ('2026-12'), amount_cents, rentals_count
  status: 'pending' | 'paid', paid_at, note

llm_costs
  id, texto_id, stage, model, input_tokens, output_tokens, created_at
```

Índices: `chunks(texto_id)`, `sections(texto_id)`, `frameworks(texto_id)`, `checklists(texto_id)`, `glossary_terms(texto_id, term)`, `textos_vivos(public_slug)` único, `rentals(user_id, texto_id, expires_at)`, `rentals(payment_ref)` único, `rentals(payout_id)`, `usage_events(user_id, created_at)`, `usage_events(rental_id)`, `payouts(author_id, period)` único.

### Reglas de alquiler
- **Activo** = `status = 'active'` y `expires_at > now`.
- Comprar un Texto Vivo que ya está activo **extiende** 30 días desde `expires_at`, no desde hoy. La cuota se suma.
- El webhook es **idempotente** por `payment_ref`.
- Un job diario (Cron Trigger) marca `expired`, manda avisos de vencimiento, borra `query_text` con más de 30 días y borra los Textos Vivos pendientes de borrado cuyo último alquiler ya venció.

### Vectorize (solo si se activa en H2)
- Un índice `textovivo-chunks`, métrica coseno, 1024 dimensiones.
- ID del vector = `chunks.id`. **Namespace = `texto_id`**. Metadatos: `section_id`, `page_start`, `page_end`.
- Al borrar un Texto Vivo, borrar los vectores por ID **[verificar]** si existe borrado por namespace.

---

## 7. Herramientas MCP (conector biblioteca)

Un solo endpoint: `https://{dominio}/mcp`. El token OAuth lleva en `props` solo el `user_id`. Las herramientas trabajan sobre los Textos Vivos **con alquiler activo** de ese usuario.

Los nombres y descripciones importan mucho: la IA decide cuándo usarlas leyendo la descripción. Como `createMcpHandler` crea el servidor en cada request y `getMcpAuthContext()` ya está disponible dentro de la factory, se pueden **registrar las herramientas con los títulos de los Textos Vivos activos del lector** en la descripción (p. ej. "Busca en *Refactoring UI*, *Inspired*..."). Usar eso; `mis_textos_vivos` queda como respaldo.

### Parámetro común `texto`
Todas las herramientas (menos `mis_textos_vivos`) reciben `texto`: id, slug o parte del título. **Es opcional si el lector tiene un solo Texto Vivo activo.** Si hay varios y falta o es ambiguo, devolver la lista para que la IA elija.

### `mis_textos_vivos`
- **Para qué:** que la IA sepa qué conocimiento tiene disponible.
- **Entrada:** ninguna.
- **Salida:** activos `{texto, titulo, autor, vence, consultas_restantes}`; vencidos de los últimos 30 días con link para renovar.

### `listar_indice`
- **Entrada:** `texto`.
- **Salida:** título, autor, índice de capítulos/secciones con páginas, nombres de frameworks y checklists disponibles.

### `buscar_concepto`
- **Entrada:** `texto`, `consulta` (string), `max_resultados` (int, por defecto 5, máximo 10).
- **Lógica:**
  1. Si la consulta coincide con un término del glosario, ponerlo primero.
  2. FTS5 en D1 filtrado por `texto_id` (top 20).
  3. Si Vectorize está activo: embedding de la consulta → Vectorize (namespace = `texto_id`, top 20) y combinar con Reciprocal Rank Fusion.
- **Salida:** lista de `{texto, seccion, pagina_inicio, pagina_fin, puntuacion}`.

### `obtener_framework`
- **Entrada:** `texto`, `nombre_o_tema`.
- **Lógica:** nombre exacto, luego similitud. Si hay varios candidatos, devolver la lista de nombres.
- **Salida:** `{nombre, resumen, pasos: [{orden, titulo, descripcion, pagina}], verificado}`.

### `obtener_checklist`
- **Entrada:** `texto`, `tema`.
- **Salida:** `{nombre, contexto, items: [{texto, pagina}], verificado}`.

### `citar_fuente`
- **Entrada:** `texto`, `afirmacion_o_tema`.
- **Salida:** `{cita_literal, capitulo, pagina}`. La cita sale del texto almacenado en D1, **nunca** generada por un LLM.

### Reglas comunes
1. **Cada llamada verifica** que el alquiler del `texto` esté activo y con cuota. Si no:
   - Vencido: *"Tu acceso a «{título}» venció el {fecha}. Renová en {link}."*
   - Sin cuota: *"Usaste las {n} consultas de este alquiler. Se renuevan al extenderlo: {link}."*
   - Nunca alquilado: *"No tenés acceso a ese libro. Podés alquilarlo en {link}."*
2. `mis_textos_vivos` y los mensajes de error **no** consumen cuota.
3. Respuestas compactas: no más de ~2.000 tokens por llamada.
4. Si no hay resultados relevantes, decirlo claramente en vez de devolver ruido.
5. Registrar cada llamada en `usage_events` y sumar `rentals.calls_used`.

### Protección contra extracción
- Cuota por alquiler: `CALLS_PER_RENTAL` (150 por defecto, ≈ 50 preguntas, porque cada pregunta usa 2 a 4 herramientas).
- Límite de velocidad: `CALLS_PER_MINUTE` (20 por defecto) por usuario.
- Máximo 10 resultados por búsqueda; citas literales de hasta ~300 caracteres.
- No existe ninguna herramienta que devuelva el texto completo o capítulos enteros.
- Alertar al admin si un usuario agota la cuota en menos de 24 h.

---

## 8. Pipeline de destilación (Cloudflare Workflows)

Sin cambios de fondo respecto de la spec anterior. Un workflow `DistillationWorkflow` por Texto Vivo. Cada etapa es un `step.do(...)` reintentable que actualiza `processing_jobs`.

**Regla:** los pasos no devuelven datos grandes. Guardar intermedios en R2 o D1 y devolver solo referencias (claves, conteos) **[verificar]** límites de estado de Workflows.

1. **Extraer texto con números de página** (por bloques de páginas).
   - PDF: `unpdf` dentro del Worker. Si falla por memoria/CPU o la calidad es mala, contenedor Python con PyMuPDF.
   - EPUB: descomprimir y convertir XHTML a texto conservando encabezados; orden del spine como "página" lógica.
   - Markdown: directo; los encabezados dan la jerarquía.
   - PDF escaneado sin texto: fallar con *"Este PDF parece escaneado; aún no lo soportamos"*.
   - Guardar en R2 (`textos/{id}/pages.json`).
2. **Limpiar.** Quitar encabezados y pies repetidos, números de página sueltos, guiones de corte.
3. **Detectar estructura.** Outline del PDF o índice del EPUB si existe; si no, heurística + confirmación con `claude-haiku-5-5`. Guardar en `sections`.
4. **Fragmentar.** Por sección, ~500 a 800 tokens con ~15 % de solapamiento, sin cortar párrafos. Guardar en `chunks` y `chunks_fts`.
5. **Indexar.** FTS5 siempre. Embeddings + Vectorize solo si se activó en H2.
6. **Destilar (el corazón del producto).** Un paso por capítulo. Claude (vía AI Gateway) con JSON estricto: frameworks, checklists, glosario. Cada elemento **debe** incluir `source.page` y `source.quote`. Validar con Zod; reintentar si no valida. Registrar tokens en `llm_costs`.
7. **Validar contra la fuente.** Cada `source.quote` debe existir en el texto de esa página (coincidencia normalizada). Si no, descartar o marcar "sin verificar". **Ninguna cita inventada llega al lector.**
8. **Deduplicar.** Fusionar frameworks o términos repetidos entre capítulos.
9. **Cerrar.** Estado `review`, borrar el original de R2 si así está configurado, email al autor.

### Prompts
En `/prompts`, versionados. Directrices:
- Extraer solo lo que el autor propone explícitamente; no inferir metodologías.
- Preferir menos elementos y fiables que muchos y dudosos.
- Mantener el idioma original del documento.
- Si un capítulo no contiene frameworks ni checklists, devolver listas vacías.

---

## 9. Pagos (Wompi El Salvador)

Documentación: `https://docs.wompi.sv`. **[verificar]** cada endpoint antes de implementar.

### Autenticación con la API
- OAuth client credentials: `client_id` = App ID del negocio, `client_secret` = API Secret (panel de Wompi → negocio → detalle) **[verificar]** URL del token y `audience`.
- Guardar el token en KV hasta que venza; no pedir uno por compra.

### Flujo de compra (transacción 3DS)
1. El lector pulsa **Alquilar 30 días** (con sesión iniciada) y llega a `/pagar/{texto_slug}`.
2. Completa el formulario de pago de TextoVivo:
   - Tarjeta: número, CVV, mes y año de vencimiento (con `autocomplete="cc-number"`, `cc-csc`, `cc-exp-month`, `cc-exp-year`).
   - Datos que Wompi exige para 3DS: nombre, apellido, email, teléfono, dirección, ciudad, código postal, país (`idPais`, ISO 3166-1 alfa-2) y región (`idRegion`, ISO 3166-2, de `GET /api/Regiones`).
   - Prellenar nombre y email desde la cuenta. Recordar en la cuenta los datos de facturación (nunca los de tarjeta) para la próxima compra.
3. `POST /api/pagos/3ds` (Worker): crea el `purchase_intent` (`pending`) y llama a `POST /TransaccionCompra/3DS` con:
   - `tarjetaCreditoDebido` y los datos del paso 2
   - `monto` = precio en dólares (4.99)
   - `urlRedirect` = `https://{dominio}/compra/{purchase_intent.id}`
   - `configuracion`: `urlWebhook` = `https://{dominio}/webhooks/wompi`, `notificarTransaccionCliente: true`
   - `datosAdicionales`: `{ purchase_intent_id, texto_id }`
4. Guarda `idTransaccion` en `purchase_intent.wompi_transaction_id` y responde al navegador solo con `urlCompletarPago3Ds`.
5. El navegador redirige al lector a `urlCompletarPago3Ds`, donde su banco completa la verificación 3DS.
6. Wompi lo devuelve a `/compra/{id}`, que muestra "Procesando pago…" y consulta el estado del `purchase_intent` cada pocos segundos. **Esta página no activa nada**: el acceso solo lo activa el webhook. Si se muestran los parámetros del redirect, validar su `hash` (orden de concatenación del redirect de API **[verificar]**).
7. Si el pago falla, mostrar el `mensaje` de Wompi en español claro y permitir reintentar (nuevo `purchase_intent`).

### Webhook (`POST /webhooks/wompi`)
1. Leer el body **crudo**, sin re-serializar.
2. Validar el header `wompi_hash` = HMAC-SHA256(body, `WOMPI_API_SECRET`). Si no coincide, responder 401 y no hacer nada.
3. Buscar el `purchase_intent` por `wompi_transaction_id` = `IdTransaccion` (respaldo: `datosAdicionales.purchase_intent_id` **[verificar]** que llegue en el webhook de 3DS).
4. Confirmar con `GET /TransaccionCompra/{IdTransaccion}`: `esAprobada = true`, `monto` = monto del `purchase_intent`, `esReal = true` (salvo `WOMPI_ALLOW_TEST_PAYMENTS=true` en desarrollo).
5. Idempotencia: si ya existe un `rental` con `payment_ref` = `IdTransaccion`, responder 200 sin hacer nada.
6. Activar o extender el alquiler, marcar el `purchase_intent` como `paid`, enviar el email de compra con la guía de conexión. Responder 200.
7. Un Cron cada 15 minutos marca `expired` los `purchase_intents` `pending` con más de 1 hora y, antes, consulta su transacción en Wompi por si el webhook se perdió.

### 9.1 Datos de tarjeta (obligatorio)
Con 3DS por API, el número de tarjeta y el CVV **pasan por la página y el Worker de TextoVivo**. Eso mete a TextoVivo en el alcance de **PCI DSS** (probablemente SAQ D). Reglas no negociables:
- El Worker solo **reenvía** los datos de tarjeta a Wompi en la misma petición. **Nunca** se guardan en D1, KV, R2, Durable Objects, colas ni caché.
- **Nunca** se escriben en logs: sin `console.log` del body en `/api/pagos/3ds`, sin enviar el body a herramientas de errores o analítica, y redactar campos de tarjeta en cualquier manejo de errores.
- La página `/pagar/*` no carga scripts de terceros (analítica, chat, píxeles). Content-Security-Policy estricta.
- Solo HTTPS (ya garantizado por Cloudflare).
- La respuesta al navegador nunca devuelve datos de tarjeta.
- Antes de producción: confirmar con Wompi qué exige a comercios que usan la API directa (certificación PCI, cuestionario SAQ) **[verificar]**.

### Reembolsos
- No hay reembolsos por despublicar o borrar.
- Reembolsos excepcionales (error, cobro duplicado): manuales en el panel de Wompi **[verificar]** si hay API de anulación. El admin marca el alquiler como `refunded` en el panel admin, lo que corta el acceso y lo excluye de la liquidación.

### Reparto
- `author_share_cents` se congela al comprar (`price_cents * AUTHOR_SHARE_PCT / 100`).

### Liquidación a autores (manual en V1)
**Regla: solo se le paga al autor lo que ya está pagado.** Un alquiler entra en una liquidación solo si:
- tiene pago aprobado (webhook válido y productivo),
- no está `refunded`,
- tiene `paid_at` de hace más de `SETTLEMENT_DAYS` (dinero ya acreditado por Wompi),
- y todavía no tiene `payout_id`.

Proceso:
1. El día 5 de cada mes, el admin genera `payouts`: agrupa por autor los alquileres que cumplen la regla y les asigna `payout_id`.
2. Lo que no cumple la regla (por ejemplo, pagos de los últimos días del mes) pasa a la liquidación siguiente.
3. Exporta CSV (autor, email, período, alquileres, monto).
4. Paga por fuera (transferencia u otro medio) y marca `paid`.
5. El autor ve en su panel: ganado pendiente de acreditar, listo para liquidar y pagado.

---

## 10. Autenticación y conexión MCP

- `workers-oauth-provider` envuelve el Worker: protege `/mcp`, expone los endpoints OAuth (metadatos, registro de clientes, autorización, token) y delega la pantalla de autorización a nuestro handler.
- **Pantalla de autorización:** si el usuario no tiene sesión, inicia sesión (Google o enlace mágico); luego ve *"{Cliente} quiere acceder a tu biblioteca de TextoVivo"* con la lista de sus alquileres activos, y aprueba. Si no tiene ninguno activo, puede aprobar igual y se le muestra el link al catálogo.
- Al aprobar, `props` = `{ user_id }`. El servidor MCP consulta los alquileres activos en cada llamada (no los guarda en el token: así un alquiler nuevo o vencido se refleja al instante).
- Revocación de conexiones desde el panel del lector.
- Registro de clientes: Claude ofrece "identidad publicada de Claude" (CIMD, recomendado), "registro automático" (DCR) o cliente propio. Soportar como mínimo DCR; CIMD si `workers-oauth-provider` lo permite **[verificar]**.
- Probar primero con **MCP Inspector**, luego como conector personalizado en Claude (plan Free y Pro), luego Claude Code y Cursor.

### Límites conocidos de los clientes (comunicar en la guía)
- **Claude Free:** permite 1 conector personalizado. Por eso TextoVivo es un solo conector para todos los alquileres.
- **Claude Team/Enterprise:** solo el owner puede agregar conectores personalizados; el miembro luego se conecta con su cuenta.
- **Claude web:** no hay link de un clic que precargue la URL; son ~6 pasos. Se puede enlazar directo a `https://claude.ai/customize/connectors`.
- **Después de la V1:** postular a TextoVivo al **Connectors Directory de Claude** para instalación en un clic **[verificar requisitos]**.

---

## 11. Privacidad, límites y legal

### Privacidad (debe ser cierto y estar en la web)
- El autor ve conteos agregados (alquileres, consultas, herramientas usadas). **Nunca** ve quién consultó ni qué preguntó.
- El texto de las consultas se guarda 30 días solo para mejorar la búsqueda y luego se borra.
- Opción (activada por defecto) de borrar el archivo original al terminar la destilación.
- Borrar un Texto Vivo elimina archivo (R2), datos (D1) y vectores (Vectorize) de forma definitiva.
- Los documentos no se usan para entrenar modelos.
- Si se activa caché o registro de AI Gateway, indicarlo y fijar retención corta.

### Límites de la V1 (configurables)
- Autor: hasta 300 páginas y 50 MB por documento; hasta 5 Textos Vivos publicados.
- Lector: 150 llamadas por alquiler; 20 llamadas por minuto.

### Legal
- **Cambio de postura respecto del concepto original:** TextoVivo ya no procesa archivos del propio usuario para su uso privado; **distribuye acceso al contenido de autores**. Hace falta acuerdo con cada autor.
- Autor: declara y garantiza que tiene los derechos digitales del contenido (si el libro salió con editorial, normalmente los tiene la editorial). Otorga a TextoVivo licencia no exclusiva para dar acceso por alquiler. Priorizar autopublicados, investigadores independientes y consultoras con metodología propia.
- Lector: licencia personal, intransferible, por 30 días. Prohibido extraer, redistribuir o usar en herramientas comerciales en producción (eso será la licencia comercial de fase 2).
- Impuestos: Wompi no actúa como Merchant of Record, así que TextoVivo es responsable del IVA y de la facturación electrónica (DTE) en El Salvador, y de la retención o declaración de lo pagado a autores **[verificar con contador]**.
- Revisión con un abogado antes del lanzamiento público (contrato de autor, términos del lector, política de privacidad).

---

## 12. Hitos de construcción

### H-1: Validación concierge (antes de construir la V1)
Worker mínimo en `/concierge`, aparte del proyecto principal:
- 1 libro de un autor invitado (acuerdo 60/40 por escrito), **destilado a mano** con Claude y cargado como JSON.
- `createMcpHandler` con las herramientas de la sección 7 sobre ese JSON, servido en una **URL secreta por comprador** (`/c/{token}/mcp`, sin OAuth) que deja de responder a los 30 días.
- Página simple con video antes/después, **un enlace de pago de Wompi creado a mano en el panel** (sin integración, `emailsNotificacion` al admin) y guía de conexión.
- Tras cada pago (llega el email de Wompi con el correo del comprador), el admin genera el token y envía la URL por email a mano.
- Medir: pagos, tiempo entre pago y primera llamada MCP, consultas por comprador, y **cuántos intentos de pago con tarjeta extranjera fallan**.

**Aceptación (en 2 semanas):** 30+ alquileres pagos; 80 %+ de compradores hacen su primera llamada sin pedir soporte; 50 %+ hacen 5+ consultas. Si no se cumple, **no avanzar** a H0: revisar precio, público o propuesta.

### H0: Base del proyecto
Proyecto Wrangler con Hono + frontend React/Vite como assets, bindings de la sección 5, migraciones D1, `.dev.vars.example`, README.
**Aceptación:** `wrangler dev` levanta app y API; migraciones limpias en local y remoto. Documentar qué servicios necesitan bindings remotos en desarrollo **[verificar]**.

### H1: Cuentas, roles y subida
Login (Google + enlace mágico), sesiones, roles, invitaciones de autor, subida a R2, panel del autor con lista.
**Aceptación:** un autor invitado sube un PDF y lo ve en su panel con estado `uploaded`. Un lector no puede subir.

### H2: Extracción, estructura e indexado
Pasos 1 a 5 del workflow, con progreso visible.
**Aceptación:** con 3 documentos reales (PDF con índice, PDF sin índice de 300+ páginas, EPUB) se generan secciones y chunks con páginas correctas, sin superar límites del Worker. Con 20 consultas de prueba (español, inglés y mezcla), FTS5 devuelve pasajes sensatos. **Aquí se decide** si hacen falta Vectorize + Workers AI y si hace falta el contenedor Python.

### H3: Destilación y validación
Pasos 6 a 9. Prompts en `/prompts`. AI Gateway y registro de costos.
**Aceptación:** en un libro práctico, al menos 80 % de frameworks y checklists correctos al revisarlos a mano, y 100 % de las citas mostradas existen en el texto. Costo de destilación medido.

### H4: Revisión, publicación y página pública
Ver, editar, eliminar, marcar verificado; aceptar términos; publicar; página `/t/{slug}`.
**Aceptación:** los cambios del autor se reflejan en lo que devuelven las herramientas; la página pública muestra índice y ejemplo sin exponer contenido completo.

### H5: Servidor MCP biblioteca (sin auth)
`createMcpHandler` en `/mcp` con las seis herramientas y alquileres simulados en D1.
**Aceptación:** con MCP Inspector, cada herramienta responde bien; con 2 alquileres activos pide elegir `texto`; con uno vencido devuelve el mensaje de renovación; la cuota se descuenta.

### H6: OAuth y conexión real
`workers-oauth-provider`, pantalla de autorización, `props` con `user_id`, revocación, guías de conexión (Claude, Claude Code, Cursor). Despliegue a producción.
**Aceptación:** un builder conecta TextoVivo en Claude (plan Free) siguiendo solo la guía en menos de 3 minutos; lo mismo en Claude Code y Cursor. Un alquiler creado después de conectar aparece sin reconectar.

### H7: Pagos y alquileres (Wompi 3DS)
Token de Wompi, formulario de pago, `purchase_intents`, `POST /TransaccionCompra/3DS` y redirección 3DS, webhook con validación HMAC + confirmación por `GET /TransaccionCompra/{id}` e idempotencia, Cron de intentos pendientes, activar/extender, marcar reembolso desde admin, Cron diario de vencimientos, emails de compra y vencimiento. Reglas de la sección 9.1.
**Aceptación:** una transacción 3DS de prueba activa el acceso en menos de 1 minuto después del 3DS; comprar de nuevo extiende 30 días desde el vencimiento; un webhook con `wompi_hash` inválido o monto distinto se rechaza; el webhook repetido no duplica; un pago rechazado muestra un mensaje claro; marcar `refunded` corta el acceso; **una búsqueda del número de tarjeta de prueba en D1, KV y en los logs del Worker no encuentra nada**.

### H8: Paneles, límites, borrado y liquidación
Panel lector, panel autor, panel admin con CSV de liquidación, límites y alertas anti-extracción, borrado completo, manejo de errores, capturas en la guía.
**Aceptación:** superar un límite muestra un mensaje claro; borrar un Texto Vivo sin alquileres activos no deja datos residuales y con alquileres activos espera al último vencimiento; la liquidación incluye solo alquileres pagados, no reembolsados y con más de `SETTLEMENT_DAYS`, y ninguno aparece en dos liquidaciones.

---

## 13. Cómo sabremos que funciona

**Prueba decisiva** (video demo de 30 s, se usa en H-1 y en cada página pública): mismo pedido a la IA, con y sin el Texto Vivo.
- *Sin:* "Revisá mi landing" → consejos genéricos.
- *Con:* "Revisá mi landing" → problemas concretos, cada uno con la regla del libro y la página exacta.

Si el "con" no es claramente mejor, mejorar la destilación (H3) antes que cualquier otra cosa.

**Métricas de la V1:**
- Conversión página pública → alquiler.
- Activación: % de compradores que hacen su primera llamada MCP en 24 h.
- Consultas por alquiler.
- % de renovación al vencer.
- Ingreso por autor por mes.
- Costo de destilación por página.

---

## 14. Fase 2 (fuera de la V1, para no perder la visión)

**Licencia comercial para builders:** un builder integra un Texto Vivo en una herramienta propia en producción y paga **por llamada**. El autor cobra su parte de cada llamada; TextoVivo la suya.
- Rieles: `paidTool` del Agents SDK de Cloudflare (precio por llamada vía x402) o cobro medido con tarjeta **[verificar]** opciones y monedas de liquidación.
- Solo se puede cobrar lo que se mide: llamadas en tiempo de ejecución. Requiere términos y límites contra extracción más estrictos.
- Validar antes con 1 o 2 builders y facturación manual.

Otros candidatos: liquidación automática a autores, registro público de autores, precio por autor, Connectors Directory de Claude, ChatGPT cuando abra conectores a planes individuales.

---

## 15. Preguntas abiertas

1. **¿Wompi acepta tarjetas emitidas fuera de El Salvador, y con 3DS?** Crítico: los builders son de cualquier país. Confirmar con Wompi antes de H-1.
2. ¿Qué exige Wompi (PCI DSS, SAQ) a comercios que usan la transacción 3DS por API con formulario propio?
3. ¿El webhook de una transacción 3DS incluye `datosAdicionales`?
4. ¿Cuál es la comisión de Wompi por transacción y en cuántos días acredita? (Ajusta `SETTLEMENT_DAYS` y el margen real.)
5. ¿Wompi tiene API de anulación/reembolso o solo panel?
6. IVA, facturación electrónica (DTE) y tratamiento fiscal de lo pagado a autores: confirmar con contador.
7. ¿US$4.99 es el precio correcto? Validar en H-1.
8. ¿150 llamadas por alquiler alcanza sin frustrar al lector y sin permitir extracción?
9. ¿FTS5 alcanza o hace falta Vectorize? (Se decide en H2.)
10. ¿`workers-oauth-provider` soporta CIMD?
11. ¿Cómo se paga a autores fuera de El Salvador en la liquidación manual?
12. ¿Requisitos para entrar al Connectors Directory de Claude?
