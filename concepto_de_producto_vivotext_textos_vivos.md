# VivoText — Convierte documentos estáticos en Textos Vivos

> **Concepto central:** Transformar libros, manuales y documentos muertos en **Textos Vivos**: módulos MCP (*Model Context Protocol*) destilados, estructurados y listos para enchufarse directamente en las herramientas de IA donde las personas ya trabajan.

---

## 1. El Problema

1. **Cementerios de PDFs:** Profesionales, estudiantes y creadores acumulan decenas de libros comprados, manuales internos, leyes y guías técnicas que rara vez vuelven a abrir porque buscar información puntual interrumpe su flujo de trabajo.
2. **Silos de IA cerrados:** Herramientas como **NotebookLM** o **Claude Projects** funcionan bien para leer o hacer preguntas casuales, pero son *salas de lectura* aisladas:
   * Encierran el conocimiento en una sola pestaña del navegador.
   * Obligan a copiar y pegar resultados hacia el editor de código, documento o herramienta donde realmente se produce.
   * **Impuesto de contexto:** Subir libros extensos a un chat tradicional consume miles de tokens en cada mensaje, agota rápidamente los límites de uso y degrada la precisión en detalles intermedios.
3. **Barrera técnica del protocolo MCP:** Aunque MCP permite conectar conocimiento externo a asistentes como Claude Desktop, Cursor o VS Code, crear un servidor MCP útil requiere programar, estructurar bases de datos, configurar archivos JSON y mantener entornos locales.

---

## 2. La Solución: ¿Qué es VivoText?

**VivoText** es una aplicación web sin fricción que actúa como un *compilador de conocimiento*. El usuario sube un libro o documento (PDF, EPUB, DOCX, Markdown) y recibe en segundos un **Texto Vivo**: un módulo MCP listo para conectar a su IA favorita.

### La metáfora del producto
* **Antes (PDF estático):** Un archivo pasivo guardado en una carpeta.
* **NotebookLM / Chats tradicionales:** Una *sala de lectura* donde vas a conversar con el texto.
* **VivoText (Texto Vivo):** Un *cartucho de conocimiento* enchufable que convierte tu IA en una **mesa de trabajo** gobernada por las reglas, datos y criterio exacto de ese autor o manual.

---

## 3. Diferenciales clave frente a la competencia

Para destacar frente a gigantes gratuitos o incluidos en suscripciones existentes, VivoText apuesta por cuatro ventajas estructurales:

### A. Portabilidad total (Cero encierro)
El libro viaja a donde tú trabajas, no al revés. Procesas el documento una sola vez y lo conectas simultáneamente en **Claude Desktop, Cursor, VS Code, Windsurf** o cualquier cliente compatible con MCP.

### B. De "leer el texto" a "ejecutar sus reglas" (Destilación operativa)
VivoText no es un simple buscador de fragmentos de texto (un RAG genérico). Durante el procesamiento, analiza la estructura del documento para extraer **herramientas con intención** que la IA puede ejecutar:
* `buscar_concepto`: Recuperación híbrida (semántica + palabras clave) de definiciones y pasajes.
* `obtener_framework`: Extrae metodologías completas, pasos secuenciales y árboles de decisión.
* `obtener_checklist`: Convierte recomendaciones del autor en listas de verificación aplicables.
* `citar_fuente`: Devuelve el pasaje literal junto con su capítulo o página exacta para evitar alucinaciones.

### C. Cero impuesto de contexto
En lugar de inyectar 400 páginas en la ventana de conversación, el Texto Vivo funciona como un índice quirúrgico. El asistente consulta únicamente la sección exacta que necesita en ese milisegundo, logrando respuestas más rápidas, precisas y sin quemar la cuota diaria de mensajes.

### D. Soberanía, privacidad y propiedad real
Al compilar el documento en un paquete local autocontenido (por ejemplo, una base de datos SQLite indexada lista para ejecutarse localmente), el usuario conserva control absoluto:
* Sus documentos confidenciales o inéditos no quedan almacenados permanentemente en servidores de terceros.
* El Texto Vivo compilado es suyo para siempre: puede respaldarlo, versionarlo o compartirlo con su equipo.

---

## 4. Casos de uso estrella

* **Desarrollo y Diseño:** Convertir libros como *Refactoring UI*, *Clean Architecture* o guías internas de estilo en un Texto Vivo conectado a Cursor para auditar código e interfaces en tiempo real bajo las reglas del libro.
* **Legal y Cumplimiento:** Transformar códigos civiles, leyes fiscales o políticas internas en un módulo capaz de auditar contratos y señalar cláusulas faltantes citando el artículo exacto.
* **Consultoría y Negocios:** Empaquetar *playbooks* de ventas, metodologías de producto o marcos estratégicos para que la IA redacte propuestas alineadas con la metodología de la firma.
* **Investigación y Escritura:** Conectar bibliografía extensa directamente al entorno de redacción para cruzar referencias y verificar citas al instante.

---

## 5. Flujo de usuario (MVP)

1. **Subir:** El usuario arrastra un archivo (PDF, EPUB, Markdown) a la web app de VivoText.
2. **Destilar:** El motor limpia el texto, detecta la jerarquía de capítulos, extrae glosarios/frameworks y construye el índice de búsqueda.
3. **Conectar en un clic:** El usuario descarga su paquete ligero local (o copia el bloque de configuración JSON / comando de instalación rápida) y lo pega en su cliente de IA.

---

## 6. Posicionamiento y Copywriting

* **Concepto paraguas:** Textos Vivos.
* **Titular principal (Hero):** *"Convierte tus libros y manuales en Textos Vivos para tu IA."*
* **Subtítulo técnico:** *"Transforma cualquier PDF o documento en un módulo MCP estructurado y listo para conectar a Claude, Cursor y más en segundos."*
* **Gancho secundario:** *"Deja de copiar y pegar desde pestañas aisladas. Lleva el criterio de tus mejores libros directamente a tu espacio de trabajo."*

---

## 7. Modelo de negocio y blindaje legal

* **Seguridad respecto a derechos de autor:** VivoText funciona estrictamente como una herramienta de procesamiento bajo demanda (similar a un conversor de formatos). No aloja, vende ni distribuye libros protegidos; cada usuario procesa sus propios archivos para uso personal o interno.
* **Monetización atractiva (anti-fatiga de suscripciones):**
  * **Freemium:** 1 o 2 Textos Vivos gratuitos (hasta cierto límite de páginas) para experimentar la magia sin fricción.
  * **Paquetes de créditos / Pago por uso:** Compra de créditos sin caducidad para destilar libros o manuales completos (ideal para usuarios individuales).
  * **Plan Pro / Equipos (Opcional):** Alojamiento en la nube mediante URLs MCP remotas y privadas para equipos que quieran compartir manuales internos sin instalar nada en sus computadoras.

---

## 8. Próximos pasos sugeridos

1. **Prueba de concepto del motor de destilación:** Tomar un libro práctico real (ej. diseño, negocios o programación) y diseñar el prompt/pipeline que extrae sus reglas y estructura en SQLite + MCP.
2. **Validación de fricción de instalación:** Definir la forma más sencilla posible para que un usuario no técnico conecte el Texto Vivo generado en su computadora.
3. **Landing page de validación:** Publicar una página sencilla explicando el concepto de *Textos Vivos* con un video demo de 30 segundos mostrando un libro auditando trabajo real dentro de Claude o Cursor.