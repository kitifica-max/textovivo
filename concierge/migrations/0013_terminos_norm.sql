-- Vocabulario automático (diccionario abierto): miles de filas por libro. Para no cargarlas todas en cada búsqueda,
-- cada término lleva su forma normalizada (minúsculas, sin tildes) y el buscador trae solo las filas que contienen las palabras de la consulta.
ALTER TABLE terminos ADD COLUMN termino_norm TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_terminos_norm ON terminos (libro, termino_norm);
