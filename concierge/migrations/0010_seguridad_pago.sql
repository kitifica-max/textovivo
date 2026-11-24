-- Defensa contra pruebas masivas de tarjetas: cada intento que llega al Worker (sin la IP en claro) y si salió bien.
CREATE TABLE intentos_tarjeta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,                 -- sha256 de la IP, 16 caracteres: sirve para contar, no para identificar
  ok INTEGER NOT NULL DEFAULT 0,         -- 1 = Wompi aceptó iniciar la verificación 3DS
  created_at TEXT NOT NULL
);
CREATE INDEX intentos_tarjeta_ip ON intentos_tarjeta(ip_hash, created_at);
CREATE INDEX intentos_tarjeta_fecha ON intentos_tarjeta(created_at);
