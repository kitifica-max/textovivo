-- Confirmación de email y recuperación de contraseña.
ALTER TABLE users ADD COLUMN email_verificado_at TEXT;   -- NULL = todavía no confirmó

-- Enlaces de un solo uso que se mandan por correo. Del token solo se guarda su sha256.
CREATE TABLE enlaces_email (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('verificar', 'restablecer')),
  expira_at TEXT NOT NULL,
  usado_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX enlaces_user ON enlaces_email(user_id, tipo, created_at);
