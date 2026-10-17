// Génère quotidien.json : hadith du jour + phrase mindset du jour (mêmes choix que l'appli)
// Lu par la fonction niyya-push pour les notifications de 8 h et 10 h.
const fs = require('fs');
const s = fs.readFileSync(__dirname + '/index.html', 'utf8');
const bloc = (debut, fin) => { const i = s.indexOf(debut); if (i < 0) throw new Error('introuvable : ' + debut); const j = s.indexOf(fin, i); return s.slice(i + debut.length, j + fin.length - 1); };
const HADITHS = eval(bloc('const HADITHS = ', '\n];'));
const BOOKS = eval('(' + bloc('const BOOKS = ', '\n};') + ')');
const MINDSET = eval(bloc('const MINDSET = ', '\n];'));
const pad = (n) => String(n).padStart(2, '0');
const out = {};
const t0 = new Date(); t0.setHours(12, 0, 0, 0); t0.setDate(t0.getDate() - 2);
for (let i = 0; i < 400; i++) {
  const d = new Date(t0); d.setDate(t0.getDate() + i);
  const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const di = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const h = HADITHS[di % HADITHS.length], m = MINDSET[(di * 7) % MINDSET.length];
  out[k] = { h: [h[0], h[1]], m: [m[1], (BOOKS[m[0]] || {}).t || ''] };
}
fs.writeFileSync(__dirname + '/quotidien.json', JSON.stringify(out));
console.log('✔︎ quotidien.json : ' + Object.keys(out).length + ' jours (hadiths ' + HADITHS.length + ', mindset ' + MINDSET.length + ')');
