-- Biblioteca personal: los libros que cada cuenta eligió agregar desde la ficha.
-- El conector sigue siendo uno solo para toda la biblioteca; esto ordena «Mi biblioteca».
CREATE TABLE mis_libros (
  user_id TEXT NOT NULL REFERENCES users(id),
  libro_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, libro_id)
);
