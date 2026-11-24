-- Texto de todos los libros, partido en páginas, con búsqueda de texto completo (FTS5).
-- libro y pagina no se indexan: solo sirven para filtrar y devolver.
CREATE VIRTUAL TABLE paginas_fts USING fts5(
  texto,
  libro UNINDEXED,
  pagina UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
