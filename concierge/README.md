# Textifika · H-1 (validación concierge)

Worker mínimo para validar, antes de construir la V1, que la gente **paga, conecta y usa** un Texto Vivo.
Un libro, una URL secreta por comprador, sin OAuth. Se descarta cuando arranca la V1 (ver `../TEXTOVIVO-SPEC-V1.md`, hito H-1).

**Metas en 2 semanas:** 30+ alquileres pagos · 80 %+ hacen su primera consulta en 24 h · 50 %+ hacen 5+ consultas.

---

## 1. Preparar el libro (con el autor invitado)

1. Firmar con el autor el acuerdo 60/40 y confirmar que tiene los derechos digitales.
2. Extraer el texto por página:
   ```bash
   npm run paginas -- ruta/al/libro.pdf 12
   ```
   El último número es el desfase: cuántas páginas del PDF hay antes de la página 1 impresa. Así las citas usan la página que ve el lector.
3. Destilar cada capítulo con [`prompts/destilar-capitulo.md`](prompts/destilar-capitulo.md) y armar `data/destilado.json` (título, autor, índice y lo que devuelve cada capítulo). El formato está en `src/schema.ts` y hay un ejemplo en `data/ejemplo/`.
4. Validar:
   ```bash
   npm test
   ```
   El primer test falla si **alguna cita no existe tal cual en su página**. No publicar hasta que pase.

> Hoy `data/` tiene el libro de ejemplo. Reemplazar `data/destilado.json` y `data/paginas.json` por el libro real.

## 2. Probar en local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Crear un comprador de prueba (no cuenta en las métricas):

```bash
curl -s -X POST http://localhost:8787/admin/compradores \
  -H "authorization: Bearer cambiar-por-un-secreto-largo" \
  -H "content-type: application/json" \
  -d '{"email":"vos@ejemplo.com","es_prueba":true}'
```

Probar la `url_mcp` que devuelve:

```bash
claude mcp add --transport http textovivo-local URL_MCP
```

Claude web no llega a `localhost`: para probar ahí, usar la versión publicada.

## 3. Publicar

```bash
npx wrangler login
npx wrangler d1 create vivotext-concierge
```

1. Pegar el `database_id` en `wrangler.jsonc`.
2. Aplicar la migración y guardar el secreto de admin (uno largo y aleatorio):
   ```bash
   npm run db:remote
   npx wrangler secret put ADMIN_SECRET
   ```
3. En `wrangler.jsonc`, completar `PUBLIC_URL` (la URL de `workers.dev`), `WOMPI_LINK_URL` y `VIDEO_URL`.
4. Publicar:
   ```bash
   npm run deploy
   ```

### Enlace de pago de Wompi (a mano, sin integración)

En el panel de Wompi, crear un enlace de pago con:

- Monto: 4.99 · Producto: `Texto Vivo: {título} (30 días)`
- Solo tarjeta de crédito/débito
- Correos de notificación: tu email (así te enterás de cada pago)
- Notificar al cliente: sí
- Sin límite de usos

Pegar la URL del enlace en `WOMPI_LINK_URL` y volver a publicar.

## 4. Operación diaria

Cuando llega el email de Wompi de un pago aprobado:

1. Dar de alta al comprador con el email que pagó:
   ```bash
   curl -s -X POST https://TU-WORKER.workers.dev/admin/compradores \
     -H "authorization: Bearer $(cat .secreto-admin)" \
     -H "content-type: application/json" \
     -d '{"email":"comprador@ejemplo.com"}'
   ```
2. Mandarle el email con su `guia_personal` (plantilla abajo). La guía ya muestra su URL y los comandos listos para copiar.

**Plantilla de email:**

> Asunto: Tu acceso a «{título}» está listo
>
> ¡Gracias por tu compra! Tu Texto Vivo está activo por 30 días.
>
> Abrí tu guía personal y conectalo a tu IA en 2 o 3 minutos:
> {guia_personal}
>
> No compartas ese link: es tu acceso. Si algo no funciona, respondé este email.

## 5. Métricas

```bash
curl -s https://TU-WORKER.workers.dev/admin/metricas -H "authorization: Bearer $(cat .secreto-admin)"
```

Devuelve las metas, los números actuales, las llamadas por herramienta y la lista de compradores (para hacer seguimiento de quien no se conectó).

Anotar aparte, porque el Worker no lo ve:

- **Pagos con tarjeta extranjera que fallan** (panel de Wompi).
- **Cuántos compradores pidieron ayuda para conectar.**

**A las 2 semanas:** si se cumplen las 3 metas, pasar a H0. Si no, revisar precio, público o propuesta antes de construir.

## Límites conocidos (a propósito, es una prueba)

- Búsqueda por palabras en memoria (TF-IDF por página). La V1 usa FTS5 en D1.
- Sin límite de llamadas por minuto, solo la cuota de 150 por compra.
- La URL secreta es el acceso: sin OAuth ni cuentas.
- Altas de compradores a mano.


---

## 4. Un libro nuevo: el flujo y sus compuertas

```bash
# 1. Texto fuente en fuentes/<id>/fuente.txt; datos en data/libros/<id>/meta.json; regex en scripts/libros.json
node scripts/preparar-libro.ts <id> --ver   # revisar los títulos detectados
node scripts/preparar-libro.ts <id>         # páginas + índice + extras + validación
node scripts/catalogo.ts                    # vuelve a validar todo y arma data/catalogo.json (solo libros aprobados)
node scripts/sitio.ts                       # pósters y fichas del sitio
```

`data/libros/<id>/extras.src.json` (opcional) lista frameworks, checklists y glosario con `buscar`: el comienzo literal de la cita.
`armar-extras.ts` encuentra la página y copia la cita del texto. Corre solo dentro de `preparar-libro.ts`, porque si el
paginado cambia, los números de página de las citas cambian.

**Compuertas** (`scripts/validar-libro.ts`). Un libro con un ERROR no entra al catálogo. Cada corrida deja el registro en
`data/libros/<id>/control.json` (fecha, sha256 de la fuente, resultado de cada control) y el resumen en `data/controles.json`.

| Control | Nivel | Qué verifica |
|---|---|---|
| `paginas` | error | numeradas 1..N sin saltos; ninguna vacía (menos de 40 caracteres) |
| `indice_cobertura` | error | el índice cubre de la página 1 a la N sin huecos ni solapes (lo previo al primer capítulo es «Preliminares») |
| `fidelidad` | error | 80 % o más de las palabras de la fuente llegaron a las páginas (el resto es cabecera, pie e índice) |
| `busqueda` | error | 12 oraciones tomadas del libro devuelven su página entre las 3 primeras en 80 % o más |
| `citas` | error | todas las citas del destilado existen literalmente en su página |
| `configuracion` | aviso | un solo capítulo en un libro largo, capítulos de una página, un capítulo de más de la mitad del libro, títulos repetidos |
| `paginas_cortas` | aviso | páginas de menos de 200 caracteres a mitad de capítulo |

Los avisos no bloquean, pero quedan en el registro: casi siempre señalan una regex a ajustar.

### Qué significa «página»

**Decisión:** la página es **lógica**: una sección de ~1.500 caracteres del texto digital, numerada desde 1. **No es la página
de ninguna edición impresa**, porque los textos son ediciones digitales de dominio público sin paginación fiel. Cada respuesta
trae además el **capítulo** y la **cita literal**, que es lo que permite ubicar el pasaje en cualquier edición.
Excepción: en *Oráculo manual* la página es el número de aforismo (`paginacion: "aforismo"` en `meta.json`), que sí coincide con el libro.
Las herramientas `listar_libros` y `listar_indice` avisan esto a la IA. Cambiar el criterio (p. ej. paginar como el PDF) exige
fuentes con paginación y es una decisión de producto aparte.

### Aviso: después de `wrangler secret put`, volver a desplegar

En este Worker (assets + código), `wrangler secret put` crea una versión que dejó de enviar `/acceso`, `/api/*`, `/c/*` y `/admin/*` al código
(todo respondía 404). Se arregla con `npx wrangler deploy`; los secretos no se borran al desplegar. Orden seguro:

```bash
tr -d '\n' < .secreto-admin | npx wrangler secret put ADMIN_SECRET && npx wrangler deploy
```


### Cobro con Wompi (plan Pro, pago único de 30 días)

Sin suscripción: Wompi no avisa cada cobro recurrente, así que cada renovación es un pago nuevo. El precio sale de `PRICE_USD` (hoy 4.99).

- **Flujo (formulario propio, transacción 3DS):** Mi biblioteca → `/pago/` (página de pago con el diseño del sitio). Al enviar, el navegador llama a `POST /api/pago/iniciar` (con sesión; crea el pago y devuelve un token firmado de 15 minutos) y manda la tarjeta **directo al Worker** (`PUBLIC_URL`/api/pago/tarjeta, con CORS solo para el sitio; no pasa por Netlify). El Worker valida la tarjeta (Luhn, Visa/Mastercard, vencimiento, CVV), llama a `POST /TransaccionCompra/3DS` de Wompi y devuelve `urlCompletarPago3Ds`; el cliente verifica con su banco y vuelve a `/pago/resultado.html?pago=…`, que consulta `POST /api/pago/estado` hasta que el plan se activa.
- **Seguridad de la tarjeta:** el número y el CVV solo pasan por memoria: no se guardan (ni en `pagos`, ni en `events`) ni se registran, ni siquiera en errores (solo el código HTTP). Máximo 3 intentos por pago y 5 pagos pendientes por hora por cuenta; el token no sirve para otra cuenta ni para otro pago. La página de pago lleva una política de seguridad (`diseno/_headers`): sin scripts de terceros y solo puede hablar con el sitio y con el Worker. Recibir tarjetas en el servidor implica obligaciones PCI del comercio: confirmar con Wompi qué exigen.
- **Defensas contra el abuso (pruebas masivas de tarjetas):** (1) Turnstile se valida en Mi biblioteca, antes de crear el pago (`POST /api/pago/iniciar` exige el token); la página `/pago/` solo usa el pago que Mi biblioteca dejó en `sessionStorage` y no carga scripts de terceros. (2) Máximo 10 intentos de tarjeta por IP y por hora (`intentos_tarjeta`, guarda un hash de la IP, no la IP). (3) Freno automático: con 25 intentos fallidos en 10 minutos en todo el sitio, el cobro con tarjeta se pausa solo y el panel lo marca. (4) Turnstile también en el login (modo `interaction-only`: invisible salvo que Cloudflare necesite una comprobación), además del registro, recuperar contraseña y envíos. Constantes en `src/api.ts` (`MAX_INTENTOS_IP_HORA`, `FALLOS_PARA_PAUSA`). La tarea diaria borra los intentos de más de 2 días.
- **Cabeceras de seguridad del sitio** (`diseno/_headers`): HSTS, `X-Frame-Options: DENY`, `Permissions-Policy` restrictiva y `nosniff`. Lo que Cloudflare ofrece a nivel de zona (WAF, Bot Fight Mode, reglas de límite de tasa) requiere tener el DNS de `kitifica.com` en Cloudflare; hoy está en Netlify.
- **Datos del titular:** la API 3DS exige ciudad, dirección, país, región, código postal y teléfono; el formulario no los pide y se completan con `WOMPI_CIUDAD`, `WOMPI_DIRECCION`, `WOMPI_PAIS`, `WOMPI_REGION`, `WOMPI_CODIGO_POSTAL` y `WOMPI_TELEFONO` (`wrangler.jsonc`). Verificar en pruebas que Wompi los acepta; si no, ajustarlos o pedirlos en el formulario.
- **Plan B:** el enlace de pago de Wompi sigue disponible (`POST /api/pago/crear`, el cliente paga en la página de Wompi y no tocamos tarjetas).
- **Confirmación:** el webhook se acepta solo con la firma `wompi_hash` (HMAC-SHA256 del cuerpo crudo con el API Secret) y, además, se confirma con `GET /TransaccionCompra/{id}` (aprobada, real y monto igual). Cada transacción activa un solo pago; repetir un webhook no suma días. Con el formulario propio la transacción se guarda al iniciarla, y el webhook y la consulta de estado la buscan por ese id (no dependen del hash del redirect).
- **Plan:** cada pago suma 30 días (si todavía queda plan, se suman al final). `users.plan_vence_at`; sin fecha = plan otorgado a mano, no vence. Vencido: los documentos personales siguen guardados pero no se suben ni se consultan.
- **Avisos:** tarea programada diaria (14:00 UTC) que manda un correo a los 7 días y otro el último día (`src/avisos.ts`).
- **Secretos:** `.secreto-wompi-appid` y `.secreto-wompi-apisecret` (los sube `npm run deploy`). El mismo API Secret firma los webhooks.
- **Modo:** `WOMPI_MODO` en `wrangler.jsonc`. `pruebas` acepta pagos de desarrollo (negocio «en desarrollo» en el panel de Wompi; llegan con `esReal = false`). `produccion` exige `esReal = true`. Para pasar a producción: quitar el modo desarrollo del negocio en Wompi, poner `"produccion"` y volver a desplegar.
- **Webhook y redirect:** en el dominio propio (`https://textifika.kitifica.com/api/wompi/webhook` y `/pago/resultado.html`); Netlify reenvía `/api/*` al Worker. Riesgo a comprobar una vez: que el proxy no descarte el encabezado `wompi_hash` (lleva guion bajo). Prueba: `curl -s -X POST https://textifika.kitifica.com/api/wompi/webhook -H "wompi_hash: x" -d "{}"` debe responder «Firma inválida»; si responde «Falta el encabezado wompi_hash», usar `PUBLIC_URL` (workers.dev) como `urlWebhook` en `crear pago`.
- **No documentado por Wompi** (confirmar con una compra de prueba): los valores posibles del resultado de una transacción y si el orden del hash del redirect (`identificadorEnlaceComercio + idTransaccion + idEnlace + monto`, sin separador) es exacto.
- **Probar en local:** hay un Wompi simulado (token, enlace, transacción y webhooks firmados) en la carpeta de trabajo de la sesión; no está en el repositorio.

### Revisión automática de aportes públicos

Cada envío se evalúa en segundo plano al subirlo (`src/evaluacion.ts`, reglas en `src/moderacion.ts`, con tests):

- **Reglas:** instrucciones dirigidas a una IA (inglés y español), caracteres invisibles, HTML/JS activo, marcas de derechos de autor, datos personales, enlaces y cadenas sospechosas, legibilidad.
- **Duplicados:** misma huella de texto ya enviada, y copia literal de algo que ya está en la biblioteca (8 tramos de 10 palabras buscados en `paginas_fts`).
- **IA de Cloudflare (Workers AI):** Llama Guard para seguridad y un modelo instruct (`MODELO_REVISION`) que clasifica derechos de terceros, inyección y spam sobre fragmentos repartidos del documento. Si la IA falla, el envío va a revisión manual: nunca se aprueba sin ella.
- **Veredicto:** `auto_ok` (pasa todo), `revision` (algo dudoso) o `bloqueado` (inyección, caracteres ocultos, código activo o contenido no seguro). Se guarda en `envios.veredicto/puntaje/motivos` y se ve en `revision.html`.
- **Modo (`APROBACION_AUTO` en `wrangler.jsonc`):** `off` no evalúa · `sombra` (por defecto) evalúa pero siempre pide aprobación manual · `on` publica solo lo que pasa todo. Conviene correr unas semanas en `sombra`, comparar el veredicto con tu decisión y pasar a `on` cuando coincidan.
- **Defensa al servir:** las respuestas del conector sobre libros aportados (`u-…`) y documentos personales (`mi-…`) llevan `aviso_de_seguridad`, para que la IA los trate como material y no como instrucciones.
- `POST /admin/envios/<id>/evaluar` repite la evaluación (también sirve para envíos anteriores al sistema).
- La IA de Cloudflare se factura por uso, incluso en `wrangler dev` (el binding siempre va a la nube).

### Documentos personales (privados por cuenta)

Cada cuenta con plan habilitado sube PDF/TXT/MD desde **Mi biblioteca** y solo ella los consulta desde su conector.

- **Plan:** `users.plan`; los planes que pueden usar la función están en `PLANES_PERSONALES` (`wrangler.jsonc`; «*» = todas las cuentas). Se otorga a mano: `POST /admin/usuarios/plan {"email": "...", "plan": "pro"}` con la clave de administrador.
- **Acceso:** el documento tiene un id `mi-…` aleatorio; el conector solo lo resuelve si el `user_id` del acceso coincide con el del documento (`src/personales.ts`, con tests). Para cualquier otra cuenta, «no existe el libro».
- **Qué se guarda:** solo el texto por páginas (`paginas_fts`) y una fila en `docs_personales`. No se guarda el archivo original. Borrar elimina ambos.
- **Límites:** 10 documentos, 7 MB cada uno, 40 MB en total, 1500 páginas por documento.
- **Privacidad:** el texto de las consultas a un documento personal no se registra (`events.query = 'mi-doc'`), y el panel solo cuenta documentos y cuentas, sin títulos.
- Sin frameworks ni checklists: tools de búsqueda (`buscar_concepto`, `listar_indice`, `citar_fuente`).

### Panel de métricas (PWA del dueño)

`/panel` (clave de administrador) muestra cuentas, consultas, la puerta de cobro y la biblioteca. Se alimenta solo:

- **Un libro nuevo:** `node scripts/catalogo.ts` lo estampa en `data/publicaciones.json` (fecha de hoy) y `npm run deploy` lo publica. El panel lo lista con la etiqueta «Nuevo» durante 14 días, con sus consultas y cuántas personas lo agregaron. No hay que tocar el panel.
- **Aportes de autores:** al aprobarlos aparecen solos (usa `publicado_at`).
- El panel solo muestra totales, nunca el texto de las consultas.

## 5. Cuentas, envíos de autores y revisión

- **Cuentas:** `POST /api/registro` y `/api/login` (email + contraseña, PBKDF2-SHA256 con 100.000 iteraciones, el tope de Workers). La sesión es la cookie `tv_sesion` (HttpOnly, SameSite=Lax); en D1 solo queda su sha256. Cinco fallos de login bloquean el email 15 minutos. **No hay verificación de email ni recuperación de contraseña** (no se envían correos): hoy se resuelve a mano desde hola@kitifica.com.
- **Conector:** cada cuenta tiene un acceso de 30 días (`buyers.user_id`); `POST /api/renovar` lo renueva cuando quedan 7 días o menos.
- **Envíos:** `POST /api/envios` (PDF, TXT o MD, hasta 7 MB) guarda el archivo en R2 (`textovivo-envios`) y la fila en `envios`, con la versión de los términos y la fecha en que aceptó los términos y la dedicación al dominio público.
- **Revisión:** `/revision.html` (pide `ADMIN_SECRET`). «Aprobar y publicar» extrae el texto (`src/extraer.ts`: PDF con `unpdf`, páginas reales; TXT/MD en secciones lógicas), lo indexa en `paginas_fts`, crea la fila en `libros_dyn` y el libro queda en la biblioteca y en el conector. Si el PDF no tiene texto, la aprobación falla con un mensaje. «Retirar» solo para contenido ilegal o infractor.
- **Términos y privacidad:** `diseno/terminos.html` y `diseno/privacidad.html`. Si cambian, subir `TERMINOS_VERSION` en `src/auth.ts`.
- **Despliegue:** usar `npm run deploy` (no `wrangler deploy` a secas): vuelve a subir `ADMIN_SECRET` desde `.secreto-admin`. Tras el despliegue, el secreto puede tardar unos segundos en responder.

### Turnstile (captcha) en el registro y en la subida

El registro (`/api/registro`) y los envíos (`/api/envios`) exigen un token de Turnstile y lo validan en el servidor. La clave pública (`TURNSTILE_SITE_KEY`, en `wrangler.jsonc`) llega al navegador por `/api/config`; la secreta (`TURNSTILE_SECRET`) es un secreto del Worker.

**Hoy se usan las claves de PRUEBA de Cloudflare, que siempre aprueban: no protegen nada.** Para activar la protección real:

1. Cloudflare → Turnstile → *Add widget*. Hostnames: `textovivo.kitifica.workers.dev` (y `localhost` si querés probar en local). Modo *Managed*.
2. Pegá la *Site key* en `TURNSTILE_SITE_KEY` de `concierge/wrangler.jsonc`.
3. Guardá la *Secret key* en `concierge/.secreto-turnstile` (ignorado por git).
4. `cd concierge && npm run deploy`. El script sube el secreto; sin ese archivo avisa y usa el de prueba.

### Confirmación de email y recuperación de contraseña (Resend)

- **Envío:** `src/correo.ts` usa la API de Resend desde `Textifika <textifika@kitifica.com>` (dominio verificado en Resend). La clave (`RESEND_API_KEY`) solo permite enviar desde `kitifica.com` y está en `concierge/.secreto-resend` (ignorado por git); `npm run deploy` la sube.
- **Local:** con `RESEND_API_KEY=consola` en `.dev.vars`, los correos se imprimen en la consola de `wrangler dev` en vez de enviarse.
- **Flujo:** al registrarse sale un correo con un enlace de 24 h (`/verificar.html#t=…`). Sin email confirmado no funcionan el conector ni la subida de obras. `POST /api/reenviar` (3 por hora). Recuperar contraseña: `/recuperar.html` (con Turnstile) → enlace de 1 h → `/restablecer.html`, que cierra todas las sesiones.
- **Tablas:** `users.email_verificado_at` y `enlaces_email` (solo el hash del token, un solo uso).
- **Probar sin bandeja:** los correos a `delivered+algo@resend.dev` los acepta Resend y se pueden leer con la API (`get-email`).

## Vocabulario por libro (búsqueda en otro idioma)

Los libros están en su idioma original; quien consulta puede escribir en español. La tabla `terminos` (migraciones `0011` y `0012`) es el puente. **No usa ningún modelo**: sale de lo que ya trae `destilado.json`.

- **Cómo se llena** (`scripts/catalogo.ts`, la ingesta, con `construirVocabulario` de `src/vocabulario.ts`): 1) **derivado del destilado**: para cada glosario, framework, checklist y capítulo, el nombre y la descripción en español como `termino` y el texto entre paréntesis como `traduccion` («Ley moral **(Moral Law)**»), con la página de su cita; 2) **`data/libros/<id>/vocabulario.json`**: sinónimos escritos y revisados por una persona (`[{"termino","traduccion","pagina","fuente":"sinonimo"}]`, p. ej. «liderazgo» → *commander*). No se usa ningún modelo.
- **Regla:** la traducción solo se guarda si aparece literal en el texto del libro. Lo derivado que no aparece queda con `traduccion = ''` y `verificado = 0` (la búsqueda solo usa los verificados). Si el paréntesis completo no está, se usa su palabra más rara que sí esté (`fuente = derivado-parcial`, p. ej. «Attack By Stratagem» → *stratagem*). Una fila de `vocabulario.json` que ya no está literal es un error: el libro no se publica hasta corregirla.
- **Cobertura:** `node scripts/terminos.ts [id]` la muestra. Los libros en español no necesitan vocabulario. Para un libro en inglés: crear su `vocabulario.json` (20 a 40 filas con las palabras que la gente usaría) y correr `node scripts/catalogo.ts`.
- **Orden de la búsqueda** (`planDeBusqueda`): 1) todas las palabras tal cual (`completa`) → 2) el vocabulario (`expandida`; la página de la fila sube en el ranking) → 3) todas las palabras por raíz (`aproximada`, prefijo `"lead"*`) → 4) cualquiera (`parcial`). Cada etapa solo corre si la anterior no encontró nada, con el umbral del 50 % en todas.
- **Stemming:** D1 documenta FTS5 y `fts5vocab` pero no menciona el tokenizer `porter`, así que no se depende de él: hay un truncado de sufijos propio (`raiz`) que se aplica a la consulta, con prefijo en FTS5.
- **Sin resultados:** `sugerencias` salen del vocabulario verificado, ordenadas por parecido (raíz o trigramas); solo si nada se parece vuelve el listado general del libro.
- **Dónde coincidió:** cada resultado trae `coincide_en` (`termino`, `posicion`, `en_fragmento`) y, si queda más allá del fragmento recortado a 1.500 caracteres, `aviso_fragmento`.
- **Documentos personales y envíos:** no tienen destilado, así que no tienen vocabulario: se buscan por sus palabras y raíces.
- **Evaluación:** `node scripts/evaluar-busqueda.ts [id] [--sin-vocabulario]` con las consultas de `data/evaluacion/<id>.json` y los mismos umbrales para todos los libros (recall@5 ≥ 80 %, primero correcto ≥ 60 %, sin resultados ≤ 10 %).
- **Al desplegar:** aplicar las migraciones (`npm run db:remote`) **antes** de `npm run deploy` y recargar las filas de `terminos` de cada libro desde `data/semilla/<id>.sql` (solo las líneas `DELETE/INSERT INTO terminos`).

### Vocabulario automático con diccionario abierto (integrado a la ingesta de los libros en inglés)

`scripts/vocabulario-auto.ts` cruza el texto de un libro en inglés con **FreeDict eng-spa 2025.11.23** y genera filas «traducción al español → palabra literal del libro», sin modelos. Descarga única: `sh scripts/descargar-diccionario.sh` (queda en `data/diccionario/`, ignorado por git). Medido con `node scripts/evaluar-busqueda.ts <id> --sin-manual --auto`: *arte de la guerra* recall@5 90 % / primero 70 %; *Scientific Advertising* 80 % / 60 %. Traduce palabras, no inventa sinónimos («liderazgo» no llega a *commander*; «comandante» sí).

**Atribuciones.** FreeDict eng-spa, derivado de WikDict / Wiktionary, licencia [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/): si el vocabulario derivado se publica o distribuye, debe citar la fuente y mantener esa licencia. Revisar con asesoría legal antes de un uso comercial.

**Integración.** `scripts/catalogo.ts` suma estas filas (`fuente = diccionario`) a las de cada libro con `idioma = en`, si existe `data/diccionario/eng-spa.tei`; lo curado (derivado del destilado y `vocabulario.json`) manda sobre lo automático. Son unos 5.000 a 6.000 términos por libro, así que la migración `0013` agrega `termino_norm` (minúsculas, sin tildes) y el buscador trae solo las filas que contienen las palabras de la consulta (`cargarTerminosD1(libro, consulta)`, tope 1.500); para las sugerencias carga solo las curadas. Medido en D1 local: 5 a 45 ms por búsqueda. **Al desplegar:** `npm run db:remote` (0012 y 0013) → cargar `terminos` desde `data/semilla/<id>.sql` (desde la línea `DELETE FROM terminos` hasta el final) → `npm run deploy`.
