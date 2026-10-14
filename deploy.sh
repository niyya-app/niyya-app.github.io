#!/bin/bash
# Publie NIYYA (version multi-utilisateurs) sur https://niyya-app.github.io
set -e
REPO="/Users/salemmehdi/niyya-app"
F="$REPO/index.html"
cd "$REPO"
git pull -q origin main 2>/dev/null || true
V="$(date '+%Y%m%d-%H%M%S')"
sed -i '' -E "s/^const VERSION='[^']*'/const VERSION='$V'/" "$F"
# garde-fou 1 : syntaxe JavaScript
node -e "const s=require('fs').readFileSync('$F','utf8');const sc=s.split('<script>');new Function(sc[sc.length-1].split('</script>')[0])" || { echo "❌ Erreur JavaScript — publication annulée"; exit 1; }
# garde-fou 2 : aucune clé secrète ni donnée perso
if grep -Eq '[0-9a-f]{64}' "$F"; then echo "❌ Clé secrète détectée — publication annulée"; exit 1; fi
if grep -Eq "nom:'Mehdi'|Déposer ma fille" "$F"; then echo "❌ Donnée personnelle détectée — publication annulée"; exit 1; fi
# garde-fou 3 : affichage réel + autotest de tous les écrans dans Chrome
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  OUT="$("$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$(mktemp -d)" --virtual-time-budget=6000 --dump-dom "file://$F" 2>/dev/null)"
  if ! echo "$OUT" | grep -q 'data-ok="1"' || ! echo "$OUT" | grep -q "Se connecter"; then echo "❌ La page ne s'affiche pas correctement — publication annulée"; exit 1; fi
  echo "✔︎ Test d'affichage réussi"
  AT="$("$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$(mktemp -d)" --virtual-time-budget=8000 --dump-dom "file://$F#autotest" 2>/dev/null | grep -o 'data-autotest="[^"]*"' | head -1)"
  if [ "$AT" != 'data-autotest="ok"' ]; then echo "❌ Autotest des écrans en échec — publication annulée : ${AT:-aucun résultat}"; exit 1; fi
  echo "✔︎ Autotest de tous les écrans réussi"
  AT2="$(TZ=America/Los_Angeles "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$(mktemp -d)" --virtual-time-budget=8000 --dump-dom "file://$F#autotest" 2>/dev/null | grep -o 'data-autotest="[^"]*"' | head -1)"
  if [ "$AT2" != 'data-autotest="ok"' ]; then echo "❌ Autotest avec un téléphone réglé sur un autre fuseau horaire en échec — publication annulée : ${AT2:-aucun résultat}"; exit 1; fi
  echo "✔︎ Autotest fuseau horaire étranger réussi"
fi
git add -A
if git diff --cached --quiet; then echo "ℹ️ Aucun changement — déjà à jour."; exit 0; fi
git commit -q -m "NIYYA $(date '+%Y-%m-%d %H:%M')

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q -u origin main
echo "✅ Déployé : https://niyya-app.github.io/"
