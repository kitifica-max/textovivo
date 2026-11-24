-- Un término sin traducción literal en el libro se guarda igual, con traduccion = '' y verificado = 0 (la búsqueda solo usa los verificados).
ALTER TABLE terminos ADD COLUMN verificado INTEGER NOT NULL DEFAULT 1;
