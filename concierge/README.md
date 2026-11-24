# TextoVivo · H-1 (validación concierge)

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

- **Envío:** `src/correo.ts` usa la API de Resend desde `TextoVivo <textovivo@kitifica.com>` (dominio verificado en Resend). La clave (`RESEND_API_KEY`) solo permite enviar desde `kitifica.com` y está en `concierge/.secreto-resend` (ignorado por git); `npm run deploy` la sube.
- **Local:** con `RESEND_API_KEY=consola` en `.dev.vars`, los correos se imprimen en la consola de `wrangler dev` en vez de enviarse.
- **Flujo:** al registrarse sale un correo con un enlace de 24 h (`/verificar.html#t=…`). Sin email confirmado no funcionan el conector ni la subida de obras. `POST /api/reenviar` (3 por hora). Recuperar contraseña: `/recuperar.html` (con Turnstile) → enlace de 1 h → `/restablecer.html`, que cierra todas las sesiones.
- **Tablas:** `users.email_verificado_at` y `enlaces_email` (solo el hash del token, un solo uso).
- **Probar sin bandeja:** los correos a `delivered+algo@resend.dev` los acepta Resend y se pueden leer con la API (`get-email`).
