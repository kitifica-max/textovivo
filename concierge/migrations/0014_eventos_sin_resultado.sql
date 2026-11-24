-- Marca las consultas que no encontraron nada (para ver en el panel qué falta en la biblioteca o en el vocabulario).
ALTER TABLE events ADD COLUMN sin_resultado INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS events_sin_resultado ON events (sin_resultado, created_at);
