// NIYYA — service worker : notifications (prières, rappels, annonces) + ouverture SANS RÉSEAU
const CACHE = 'niyya-app-v1';
const BASE = ['./', 'vendor/supabase.min.js', 'vendor/adhan.umd.min.js', 'manifest.json', 'niyya-icon-180.png', 'niyya-icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(BASE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('niyya-app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Page : réseau d'abord (toujours la dernière version), copie gardée pour ouvrir l'appli hors ligne
// Bibliothèques / icônes / polices : copie locale tout de suite, mise à jour en arrière-plan
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  const page = url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
  if (page) { e.respondWith(reseauDabord(req)); return; }
  const local = url.origin === scope.origin && /\.(js|png|json)$/.test(url.pathname) && !/(quotidien|version)\.json$/.test(url.pathname) && !url.pathname.endsWith('/sw.js');
  const police = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (local || police) e.respondWith(copieDabord(req, local ? url.origin + url.pathname : req.url));
});

async function reseauDabord(req) {
  const c = await caches.open(CACHE);
  try {
    // si le réseau est très lent (sous-sol, zone blanche), on ouvre la copie au bout de 4 s
    const r = await Promise.race([fetch(req), new Promise((_, ko) => setTimeout(() => ko(new Error('lent')), 4000))]);
    if (r && r.ok) c.put('./', r.clone()).catch(() => null);
    return r;
  } catch (err) {
    const copie = await c.match('./');
    if (copie) return copie;
    return fetch(req);
  }
}
async function copieDabord(req, cle) {
  const c = await caches.open(CACHE);
  const copie = await c.match(cle);
  const maj = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(cle, r.clone()).catch(() => null); return r; }).catch(() => null);
  if (copie) { maj; return copie; }
  const r = await maj;
  return r || new Response('', { status: 504 });
}

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'NIYYA', body: e.data ? e.data.text() : '' }; }
  // on garde aussi la notification REÇUE : l'appli peut l'afficher en entier même si l'iPhone ne signale pas le toucher
  const recue = { tag: d.tag || '', title: d.title || 'NIYYA', body: d.body || '', t: Date.now(), essai: !!d.essai };
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'NIYYA', {
      body: d.body || '', icon: 'niyya-icon-180.png', badge: 'niyya-icon-180.png', tag: d.tag || 'niyya', renotify: true,
      data: { url: d.url || './', tag: d.tag || '', body: d.body || '', essai: !!d.essai }
    }),
    caches.open('niyya-clic').then(async c => {
      await c.put('recue', new Response(JSON.stringify(recue)));
      // historique des 15 dernières notifications reçues (pour retrouver celle qu'on a touchée, même longtemps après)
      let L = []; try { const r = await c.match('recues'); if (r) L = await r.json(); } catch (x) {}
      L.unshift(recue); await c.put('recues', new Response(JSON.stringify(L.slice(0, 15))));
    }).catch(() => null),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage({ recue }))).catch(() => null)
  ]));
});

// Toucher une notification ouvre directement le bon écran
function cibleDe(tag) {
  if (/^priere-/.test(tag)) return tag; // ex. priere-asr : l'appli affiche le verset en entier
  if (tag === 'hadith' || tag === 'mindset' || tag === 'recap' || tag === 'soir' || tag === 'calendrier') return tag;
  return 'jour';
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cible = cibleDe((e.notification.data && e.notification.data.tag) || e.notification.tag || '');
  const url = new URL('./?ouvrir=' + cible, self.registration.scope).href;
  // l'iPhone ne transmet pas toujours le message à l'appli déjà ouverte : on note aussi le clic, l'appli le lit en revenant au premier plan
  const corps = (e.notification.data && e.notification.data.body) || e.notification.body || ''; // le texte complet voyage avec le clic (pas besoin de réseau)
  const essai = !!(e.notification.data && e.notification.data.essai);
  const note = caches.open('niyya-clic').then(c => Promise.all([
    c.put('clic', new Response(JSON.stringify({ cible, t: Date.now(), corps, essai }))),
    c.put('dernier', new Response(JSON.stringify({ cible, t: Date.now() }))) // gardé pour le diagnostic (jamais effacé par l'appli)
  ])).catch(() => null);
  e.waitUntil(note.then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) {
      if (c.url.startsWith(self.registration.scope) && !/admin\.html/.test(c.url) && 'focus' in c) { c.postMessage({ ouvrir: cible, corps, essai }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })));
});
