-- Compradores del H-1: una URL secreta (token) por compra.
CREATE TABLE buyers (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  es_prueba INTEGER NOT NULL DEFAULT 0,   -- 1 = no cuenta en las métricas
  created_at TEXT NOT NULL,               -- ISO UTC
  expires_at TEXT NOT NULL,
  first_call_at TEXT,
  last_call_at TEXT,
  calls INTEGER NOT NULL DEFAULT 0
);

-- Una fila por llamada a una herramienta.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL REFERENCES buyers(token),
  tool TEXT NOT NULL,
  query TEXT,                             -- se usa para mejorar la destilación; no se comparte con el autor
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX events_token ON events(token);
