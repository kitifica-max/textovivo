-- Documentos personales: cada cuenta sube los suyos y solo ella los consulta desde su conector.
-- Del archivo original no se guarda nada: solo el texto por páginas (paginas_fts, libro = id del documento).
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'gratis';   -- los planes habilitados se definen en PLANES_PERSONALES

CREATE TABLE docs_personales (
  id TEXT PRIMARY KEY,                       -- «mi-» + aleatorio: no se puede adivinar ni sirve sin ser el dueño
  user_id TEXT NOT NULL REFERENCES users(id),
  titulo TEXT NOT NULL,
  archivo_nombre TEXT NOT NULL,
  idioma TEXT NOT NULL DEFAULT 'es',
  paginacion TEXT NOT NULL,                  -- logica | pdf
  indice TEXT NOT NULL,                      -- JSON
  paginas INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX docs_personales_user ON docs_personales(user_id, created_at);
