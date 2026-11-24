-- Vocabulario por libro: puente entre lo que escribe quien consulta (español, inglés, sinónimos) y las palabras del texto.
-- termino    = como lo diría quien consulta.
-- traduccion = palabra o frase COPIADA del texto del libro (se valida que aparezca literal en `pagina` antes de guardar).
-- fuente     = de dónde sale: capitulo, glosario, framework, checklist o sinonimo (sinónimo suelto: no señala página).
CREATE TABLE IF NOT EXISTS terminos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  libro TEXT NOT NULL,
  termino TEXT NOT NULL,
  traduccion TEXT NOT NULL,
  pagina INTEGER NOT NULL,
  fuente TEXT NOT NULL,
  UNIQUE (libro, termino, traduccion)
);
CREATE INDEX IF NOT EXISTS idx_terminos_libro ON terminos (libro);
CREATE INDEX IF NOT EXISTS idx_terminos_consulta ON terminos (libro, termino COLLATE NOCASE);
