-- Cuentas, sesiones y envíos de autores. Los libros aprobados viven en libros_dyn y sus páginas en paginas_fts.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,                  -- en minúsculas
  nombre TEXT NOT NULL,
  pass_hash TEXT NOT NULL,                     -- PBKDF2-SHA256, base64
  pass_salt TEXT NOT NULL,
  terms_version TEXT NOT NULL,                 -- versión de los términos que aceptó al crear la cuenta
  terms_accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                 -- sha256 del token de la cookie; el token no se guarda
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Contra fuerza bruta: 5 fallos seguidos bloquean el email 15 minutos.
CREATE TABLE login_fallos (
  email TEXT PRIMARY KEY,
  fallos INTEGER NOT NULL,
  bloqueado_hasta TEXT
);

ALTER TABLE buyers ADD COLUMN user_id TEXT;   -- el acceso (conector) pertenece a una cuenta
CREATE INDEX buyers_user ON buyers(user_id);

CREATE TABLE envios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  titulo TEXT NOT NULL,
  autor_nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('libro', 'documento', 'tesis')),
  idioma TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  archivo_key TEXT NOT NULL,                   -- clave en R2
  archivo_nombre TEXT NOT NULL,
  archivo_bytes INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'recibido' CHECK (estado IN ('recibido', 'aprobado', 'retirado')),
  terms_version TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,             -- aceptó los términos al enviar
  dominio_publico_at TEXT NOT NULL,            -- declaró que es titular y dedica la obra al dominio público
  created_at TEXT NOT NULL,
  revisado_at TEXT,
  nota TEXT,                                   -- nota interna o motivo de retiro
  libro_id TEXT
);
CREATE INDEX envios_user ON envios(user_id, created_at);
CREATE INDEX envios_estado ON envios(estado, created_at);

CREATE TABLE libros_dyn (
  id TEXT PRIMARY KEY,
  envio_id TEXT NOT NULL REFERENCES envios(id),
  titulo TEXT NOT NULL,
  autor TEXT NOT NULL,
  tipo TEXT NOT NULL,
  idioma TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  paginacion TEXT NOT NULL,                    -- logica | pdf
  indice TEXT NOT NULL,                        -- JSON
  paginas INTEGER NOT NULL,
  publicado_at TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1
);
