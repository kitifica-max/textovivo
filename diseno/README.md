# TextoVivo · diseño del sitio ("guía de bolsillo")

Prototipo navegable en HTML y CSS, sin frameworks. Es la referencia visual de la V1 (`../TEXTOVIVO-SPEC-V1.md`).

```bash
python3 -m http.server 4173 --directory diseno
```

Después abrir http://localhost:4173.

## Idea

Un Texto Vivo es una guía de bolsillo de principios destilados de un libro. El sitio se arma igual:

- Una grilla de **pósters de color plano**, cada uno numerado y con su propia voz tipográfica, sobre fondo crema.
- Los frameworks y checklists de cada libro, el catálogo y los pasos de conexión son pósters.

Tomé el criterio de Apple:

- Encabezado translúcido.
- Respuesta inmediata al presionar.
- Resortes sin rebote.
- Tracking según el tamaño.
- Soporte de movimiento reducido, transparencia reducida y más contraste.

## Páginas

| Archivo | Qué es |
|---|---|
| `index.html` | Portada: titular enorme y TextoVivo explicado en 10 pósters |
| `biblioteca.html` | Tienda: un póster por libro, filtros con control segmentado |
| `texto.html` | Ficha de *El arte de la guerra*: 8 frameworks y 8 checklists como pósters, con páginas reales |
| `pagar.html` | Pago con tarjeta + 3DS (Wompi) |
| `entrar.html` | Login sin contraseñas: Google o enlace por email |
| `mi-biblioteca.html` | Panel del lector: conector, préstamo, conexiones |
| `guia.html` | Guía de conexión: Claude, Claude Code y Cursor |
| `autores.html` | Programa para autores |

## Sistema (`estilos.css`)

- **Tipos:**
  - Archivo, variable, con eje de ancho: va de la grotesca negra a la angosta.
  - Instrument Serif: alta y cursiva.
  - IBM Plex Mono.
- **Pósters:**
  - `.poster` + un color `.c-*` (azul, naranja, rojo, menta, salmón, celeste, acero, bosque, manteca, hueso, blanco, cuadrícula, negro) + una voz `.t-*` (grotesca, negra, angosta, serif, alta, cursiva, mono, escalonada).
  - `.plegado` agrega pliegues de papel.
- **Tipo dentro de los pósters:** se mide en `cqi`, contra el ancho del póster y no de la ventana. Así escala como un afiche en cualquier grilla.
- **Otras piezas:** `.boton` (píldora), `.campo`, `.segmentado`, `.tarjeta`, `.terminal`, `.estado`, `.medidor`, `.lista`, `.banda`.
- **Modo oscuro:** automático.

## Verificado

- 8 páginas × 5 anchos (1440, 1280, 1024, 768 y 375 px): ningún texto cortado dentro de un póster y ningún scroll horizontal.
- Modo oscuro y móvil revisados a ojo.

## Datos

- **Reales:** los frameworks, checklists, páginas, capítulos y citas de *El arte de la guerra* (de `concierge/data/`).
- **De ejemplo:** el email del lector, los días y consultas del préstamo, el estado del conector y el panel del autor (marcado "Ejemplo").
- **Placeholder:** el dominio `textovivo.app`.

## Al pasarlo a la V1 (React + Tailwind)

- Servir las fuentes desde el propio dominio. La página de pago no puede cargar nada de terceros (PCI).
- Usar el botón oficial de "Continuar con Google" según su guía de marca.
- Llevar los tokens de `:root` y los colores `.c-*` a la configuración de Tailwind.

## Publicado

- **URL:** https://textovivo.kitifica.workers.dev, en Cloudflare Workers, solo archivos estáticos (`wrangler.jsonc`).
- **Aviso:** cada página dice que es un prototipo. `_headers` agrega `noindex` para que no lo indexen los buscadores.
- **No se publican:** `wrangler.jsonc`, `README.md` y `.assetsignore`.
- **Despliegue a mano:** `npx wrangler deploy` desde `diseno/`.
- **Despliegue automático:** al conectar el repo de GitHub en Cloudflare (Workers Builds), con *root directory* `diseno` y *deploy command* `npx wrangler deploy`. Cada push a `main` publica solo.
