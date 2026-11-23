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
