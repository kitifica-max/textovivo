// Service worker del panel (solo el dueño). Cachea el armazón para abrir rápido y sin conexión.
// Nunca toca /admin/* ni nada fuera del panel: los datos siempre salen de la red.
const VERSION = "panel-v2";
const ACTIVOS = ["/panel.js", "/estilos.css", "/icon-192.png", "/icon-512.png", "/panel.webmanifest"];

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const esPanel = req.mode === "navigate" && (url.pathname === "/panel" || url.pathname === "/panel.html");
  if (esPanel) {
    // Red primero (para ver siempre la versión nueva); sin conexión, la última copia.
    e.respondWith(fetch(req).then((r) => { if (r.ok && !r.redirected) { const c = r.clone(); caches.open(VERSION).then((k) => k.put("/panel", c)); } return r; }).catch(() => caches.match("/panel")));
    return;
  }
  if (ACTIVOS.includes(url.pathname)) {
    // Copia al instante y se actualiza por detrás.
    e.respondWith(caches.open(VERSION).then(async (k) => {
      const guardado = await k.match(req);
      const red = fetch(req).then((r) => { if (r.ok) k.put(req, r.clone()); return r; }).catch(() => guardado);
      return guardado || red;
    }));
  }
});
