// NIYYA — envoi des notifications (Supabase Edge Function « niyya-push »)
// - action "cle"       : renvoie la clé publique VAPID (générée et stockée par la fonction elle-même au 1er appel)
// - action "tick"      : appelée chaque minute par pg_cron → notification à l'heure exacte de chaque adhan
//                        (sans secret : l'appel est idempotent, une prière n'est jamais notifiée deux fois)
// - action "tick" envoie aussi : 📜 hadith du jour à 8 h et 💡 phrase mindset à 9 h 30 (heure locale de l'utilisateur),
//                        contenu lu dans https://niyya-app.github.io/quotidien.json (généré à chaque mise en ligne, identique à l'appli)
// - action "test"      : envoie une notification de test à un abonnement donné
// - action "broadcast" : message de l'administrateur à tous les abonnés (lien secret du back-office requis)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import * as adhan from "npm:adhan@4.4.3";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-cron", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const rep = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Clé serveur fournie automatiquement par Supabase (selon l'ancienneté du projet : clé « service_role » ou nouvelle clé secrète)
const CLE_SERVEUR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => { try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0]; } catch { return undefined; } })() || Deno.env.get("SUPABASE_SECRET_KEY");
const sb = createClient(Deno.env.get("SUPABASE_URL")!, CLE_SERVEUR as string, { auth: { persistSession: false } });
// Clés VAPID : créées une seule fois par la fonction et gardées dans la table fermée niyya_push_cles
const b64u = (a: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let CLES: { publique: string; privee: string } | null = null;
async function cles() {
  if (CLES) return CLES;
  const { data } = await sb.from("niyya_push_cles").select("publique, privee").eq("id", 1).maybeSingle();
  if (data) { CLES = data; }
  else {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const neuves = { publique: b64u(pub), privee: String(jwk.d) };
    const { error } = await sb.from("niyya_push_cles").insert({ id: 1, ...neuves });
    if (error) { const { data: d2 } = await sb.from("niyya_push_cles").select("publique, privee").eq("id", 1).single(); CLES = d2!; }
    else CLES = neuves;
  }
  webpush.setVapidDetails("https://niyya-app.github.io", CLES!.publique, CLES!.privee);
  return CLES!;
}

// Calendrier annuel de la mosquée An-Nour (Hérouville-Saint-Clair) : 6 horaires HHMM par jour
const CAL: string[] = ["073308571310145617161836|073308571310145717171837|073308571311145817181838|073308571311145917201839|073308571312150017211840|073308571312150117221841|073308561312150217231842|073308561313150317241843|073308561313150417251844|073208551314150517271845|073208551314150617281847|073208541315150717291848|073108541315150817311849|073108531315151017321850|073008521316151117341851|073008521316151217351853|072908511316151317361854|072908501317151517381855|072808491317151617391856|072708481317151717411858|072708471318151817421859|072608461318152017441900|072508451318152117461902|072408441318152217471903|072308431319152417491905|072208421319152517501906|072108411319152617521907|072008401319152817541909|071908381319152917551910|071808371320153017571912|071708361320153217591913","071608341320153318001915|071508331320153418021916|071308321320153618041918|071208301320153718051919|071108291320153818071921|071008271320154018091922|070808261320154118101923|070708241321154218121925|070508221321154418141927|070408211321154518151928|070208191321154618171930|070108171321154818191931|065908161321154918201933|065808141321155018221934|065608121321155218241936|065508111320155318251937|065308091320155418271939|065108071320155518291940|065008051320155718301942|064808031320155818321943|064608011320155918341945|064408001320160018351946|064307581320160218371948|064107561320160318381949|063907541320160418401951|063707521319160518421953|063507501319160618431954|063307481319160718451956|063107461319160918471957","062907441319161018481959|062707421318161118502000|062507401318161218512002|062307381318161318532003|062107361318161418552005|061907341318161518562007|061707321317161618582008|061507301317161718592010|061307281317161819012011|061107261317161919022013|060907231316162019042015|060707211316162119062016|060507191316162219072018|060307171315162319092019|060007151315162419102021|055807131315162519122023|055607111315162619132024|055407091314162719152026|055207071314162819162027|054907041314162919182029|054707021313163019192031|054507001313163119212032|054306581313163219222034|054006561313163319242036|053806541312163319262037|053606521312163419272039|053406501312163519292041|053106471311163619302042|062907451411173720322144|062707431411173820332146|062407411410173820352147","062207391410173920362149|062007371410174020382151|061807351410174120392153|061507331409174120412154|061307311409174220422156|061107291409174320442158|060807261408174420452200|060607241408174420472202|060407221408174520482203|060107201408174620502205|055907181407174720512207|055607161407174720532209|055407141407174820542211|055207121407174920562212|054907101406174920572214|054707081406175020592216|054507061406175121002218|054307041406175121022220|054007021405175221032222|053807001405175221052224|053606581405175321062226|053306571405175421082228|053106551405175421092229|052906531404175521112231|052606511404175621122233|052406491404175621142235|052206471404175721152237|052006461404175721172239|051706441404175821182241|051506421404175921202243","051506421404175921202244|051206401403175921222246|051006381403180021232248|050806371403180021252250|050606351403180121262252|050406331403180221282254|050106321403180221292256|045906301403180321302258|045706291403180321322300|045506271403180421332302|045306261403180421352304|045106241403180521362306|044906231403180621392309|044706211403180621392309|044506201403180621402311|044306191403180721422313|044106171403180721432315|043906161403180821442317|043806151403180821462319|043606141403180921472321|043406121403180921482323|043206111403181021492325|043106101403181021512327|042906091403181121522328|042706081403181121532330|042606071403181221542332|042406061404181221552334|042306051404181321562335|042106051404181321582337|042006041404181421592339|041906031404181422002340","041606021404181522012343|041506011404181522022344|041406001405181622032346|041306001405181622042347|041205591405181622052349|041105591405181722062350|041005581405181722072351|040905581406181822072352|040905581406181822082353|040805571406181822092354|040805571406181922092355|040705571406181922102356|040705571407181922102357|040605571407182022112358|040605571407182022112358|040605571407182022122359|040605571407182022122359|040605571408182122130000|040605571408182122130000|040605571408182122130000|040605571408182122130001|040605581409182222130001|040705581409182222140001|040705581409182222140001|040805591409182222140001|040805591409182222140000|040905591410182222140000|041006001410182222130000|041006011410182222132359|041106011410182322132359","041206021410182322132358|041306021411182322122357|041406031411182322122357|041506041411182322122356|041706051411182322112355|041806051411182322112354|041906061411182322102353|042106071412182222102352|042206081412182222092351|042306091412182222082350|042506101412182222082348|042606111412182222072347|042806121412182222062346|043006131412182222052344|043106141412182122042343|043306151413182122032341|043506161413182122022340|043606171413182122012338|043806191413182022002336|044006201413182021592335|044206211413182021582333|044406221413181921572331|044506231413181921562329|044706251413181821552328|044906261413181821532326|045106271413181721522324|045306291413181721512322|045506301413181621492320|045706311413181621482318|045906331413181521462316|050106341413181521452314","050206351413181421442312|050406371413181321422310|050606381413181321402308|050806391412181221392306|051006411412181121372303|051206421412181121362301|051406441412181021342259|051606451412180921322257|051806461412180821312255|052006481412180721292252|052206491412180721272250|052406511411180621252248|052606521411180521242246|052706531411180421222243|052906551411180321202241|053106561411180221182239|053306581410180121162237|053506591410180021142234|053707011410175921122232|053907021410175821102230|054007031409175721092227|054207051409175621072225|054407061409175521052223|054607081409175321032220|054807091408175221012218|055007111408175120592216|055107121408175020572213|055307141407174920552211|055507151407174820532208|055707161407174620512206|055807181407174520482204","060007191406174420462201|060207211406174220442159|060307221406174120422157|060507241405174020402154|060707251405173820382152|060907261405173720362150|061007281404173620342147|061207291404173420322145|061307311404173320302143|061507321403173220272140|061707341403173020252138|061807351402172920232136|062007361402172720212133|062207381402172620192131|062307391401172420172129|062507411401172320142126|062607421401172120122124|062807441400172020102122|063007451400171820082119|063107471400171720062117|063307481359171520042115|063407491359171420022113|063607511359171219592110|063707521358171119572108|063907541358170919552106|064007551358170819532104|064207571357170619512101|064307581357170419492059|064508001357170319472057|064608011356170119442055","064808031356170019422053|065008041356165819402051|065108061355165719382049|065308071355165519362046|065408091355165319342044|065508101354165219322042|065708121354165019302040|065808131354164919282038|070008151354164719262036|070108161353164619242034|070308181353164419222032|070408191353164219192030|070608211353164119172028|070708221352163919152026|070908241352163819132024|071008251352163619122022|071208271352163519102021|071308281351163319082019|071508301351163219062017|071608321351163019042015|071808331351162919022013|071908351351162719002012|072108361351162618582010|072208381351162418562008|062407391250152317551906|062507411250152117531905|062607431250152017511903|062807441250151917491902|062907461250151717481900|063107471250151617461858|063207491250151517441857","063407511250151317421855|063507521250151217411854|063707541250151117391853|063807551250150917381851|063907571250150817361850|064107591250150717351849|064208001250150617331847|064408021250150517321846|064508041250150417301845|064608051250150217291844|064808071250150117281842|064908081251150017261841|065108101251145917251840|065208111251145817241839|065308131251145717221838|065508151251145717211837|065608161251145617201836|065708181252145517191835|065908191252145417181834|070008211252145317171834|070108221252145217161833|070308241253145217151832|070408251253145117141831|070508271253145017131831|070608281254145017121830|070808291254144917121830|070908311254144917111829|071008321255144817101828|071108341255144817101828|071208351255144817091828","071408361256144717091827|071508371256144717081827|071608391256144717081827|071708401257144617071826|071808411257144617071826|071908421258144617071826|072008431258144617061826|072108441258144617061826|072208451259144617061826|072308461259144617061826|072308471300144617061826|072408481300144617061826|072508491301144617061826|072608501301144617061827|072708511302144717071827|072708521302144717071827|072808521303144717071827|072908531303144817071828|072908541304144817081828|073008541304144817081829|073008551305144917091829|073108551305144917091830|073108561306145017101830|073208561306145117101831|073208561307145117111831|073208571307145217121832|073308571308145317131833|073308571308145317131834|073308571309145417141834|073308571309145517151835|073308571310145617161836"];
const PRIERES = [["fajr", "Fajr", 0], ["dhuhr", "Dhuhr", 2], ["asr", "Asr", 3], ["maghrib", "Maghrib", 4], ["isha", "Isha", 5]] as const;
const METHODES: Record<string, [number, number]> = { uoif: [12, 12], isna: [15, 15], mwl: [18, 17] };

function partsTz(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d);
  const g = (t: string) => (p.find((x) => x.type === t) || { value: "0" }).value;
  return { y: +g("year"), m: +g("month"), d: +g("day"), min: (+g("hour") % 24) * 60 + +g("minute"), wd: g("weekday") };
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function horaires(params: any, now: Date): { tz: string; t: number[]; jour: string; min: number; vendredi: boolean; dimanche: boolean } {
  const hsc = !!params.hsc;
  const tz = hsc ? "Europe/Paris" : (params.tz || "Europe/Paris");
  const P = partsTz(now, tz);
  const jour = `${P.y}-${String(P.m).padStart(2, "0")}-${String(P.d).padStart(2, "0")}`;
  let t: number[];
  if (hsc || params.lat == null) {
    const row = (CAL[P.m - 1] || "").split("|")[P.d - 1] || CAL[P.m - 1].split("|").pop()!;
    t = [0, 1, 2, 3, 4, 5].map((i) => +row.substr(i * 4, 2) * 60 + +row.substr(i * 4 + 2, 2));
  } else {
    const [f, i] = METHODES[params.methode] || METHODES.uoif;
    const c = new adhan.Coordinates(params.lat, params.lon);
    const pr = new adhan.CalculationParameters("Other", f, i);
    pr.madhab = adhan.Madhab.Shafi; pr.highLatitudeRule = adhan.HighLatitudeRule.recommended(c);
    const pt = new adhan.PrayerTimes(c, new Date(P.y, P.m - 1, P.d, 12), pr);
    const mn = (x: Date) => partsTz(x, tz).min;
    t = [mn(pt.fajr), mn(pt.sunrise), mn(pt.dhuhr), mn(pt.asr), mn(pt.maghrib), mn(pt.isha)];
  }
  return { tz, t, jour, min: P.min, vendredi: P.wd === "Fri", dimanche: P.wd === "Sun" };
}

async function envoyer(row: any, payload: Record<string, unknown>) {
  try {
    await webpush.sendNotification(row.sub, JSON.stringify(payload), { TTL: 1800, urgency: "high" });
    return true;
  } catch (e: any) {
    const code = e?.statusCode;
    if (code === 404 || code === 410) await sb.from("niyya_push").update({ actif: false }).eq("endpoint", row.endpoint);
    console.error("push", code, e?.body || e?.message);
    return false;
  }
}

// Hadith + mindset du jour (fichier généré par l'appli à chaque mise en ligne)
let QUOT: { data: Record<string, { h: string[]; m: string[] }>; le: number } | null = null;
async function quotidien() {
  if (QUOT && Date.now() - QUOT.le < 3600e3) return QUOT.data;
  try { const r = await fetch("https://niyya-app.github.io/quotidien.json?t=" + Date.now()); if (r.ok) QUOT = { data: await r.json(), le: Date.now() }; }
  catch (e) { console.error("quotidien", e); }
  return QUOT?.data || null;
}
const RAPPELS = [["h", 8 * 60, "hadith"], ["m", 9 * 60 + 30, "mindset"]] as const;

// 📊 Récap de la semaine (dimanche 20 h) : calculé à partir des journées de l'utilisateur, envoyé à lui seul
const decale = (jour: string, n: number) => { const d = new Date(jour + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function recap(uid: string, jour: string) {
  const { data: jours } = await sb.from("niyya_jours").select("jour, data").eq("user_id", uid).gte("jour", decale(jour, -13)).lte("jour", jour);
  const { data: prof } = await sb.from("niyya_profils").select("data").eq("user_id", uid).maybeSingle();
  const debut = decale(jour, -6);
  const sem = (jours || []).filter((j: any) => j.jour >= debut), avant = (jours || []).filter((j: any) => j.jour < debut);
  if (!sem.length) return null;
  let prieres = 0, mosquee = 0, sport = 0, coran = 0, essN = 0;
  // les 6 essentiels choisis par l'utilisateur (par défaut : sport, Coran, lecture, famille, adhkar matin/soir)
  const HIST = ["sport", "coran", "lecture", "famille", "adhM", "adhS"];
  const ess: string[] = (Array.isArray(prof?.data?.ess) ? prof.data.ess : HIST).slice(0, 6);
  for (const j of sem) {
    for (const id of ess) { const d = j.data || {}; if (HIST.includes(id) ? (id === "sport" ? (d.sport || d.repos) : d[id]) : d.essX?.[id]) essN++; }
    const p = (j.data && j.data.p) || {};
    for (const v of Object.values(p)) { if (v === "heure" || v === "retard" || v === "mosquee") prieres++; if (v === "mosquee") mosquee++; }
    if (j.data?.sport) sport++;
    if (j.data?.coran) coran++;
  }
  const detail = [ess.includes("sport") ? `🏃 Sport : ${sport} j` : "", ess.includes("coran") ? `📖 Coran : ${coran} j` : ""].filter(Boolean).join(" · ");
  const lignes = [`🕌 ${prieres}/35 prières${mosquee ? ` (${mosquee} à la mosquée)` : ""}`, `✅ Essentiels : ${essN}/${sem.length * 6}`];
  if (detail) lignes.push(detail);
  if (prof?.data?.fumeur) {
    const moy = (l: any[]) => l.length ? l.reduce((s, j) => s + ((j.data?.cig || []).length), 0) / l.length : null;
    const m1 = moy(sem), m0 = moy(avant);
    if (m1 != null) {
      const diff = m0 != null ? Math.round(m1 - m0) : 0;
      lignes.push(`🚭 ${Math.round(m1)} cigarettes/jour${m0 != null && diff !== 0 ? ` (${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs semaine passée)` : ""}`);
    }
  }
  lignes.push(prieres >= 30 ? "Superbe semaine, mashaAllah 🌟" : "Chaque pas compte, qu'Allah t'accorde la constance 🤲");
  return { title: "📊 Ta semaine NIYYA", body: lignes.join("\n"), tag: "recap" };
}

async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { /* vide */ }
  const action = body.action || "tick";
  const C = await cles();

  if (action === "cle") return rep({ publique: C.publique });

  if (action === "tick") {
    const now = new Date();
    const { data: subs, error } = await sb.from("niyya_push").select("endpoint, sub, params, dernier, dernier_q, user_id").eq("actif", true);
    if (error) return rep({ erreur: error.message }, 500);
    let envoyes = 0;
    const parType: Record<string, number> = { priere: 0, hadith: 0, mindset: 0, recap: 0 }; // statistiques anonymes d'envoi
    for (const row of subs || []) {
      const params = row.params || {};
      const actives: string[] = Array.isArray(params.prieres) ? params.prieres : PRIERES.map((p) => p[0]);
      let H; try { H = horaires(params, now); } catch (e) { console.error("horaires", e); continue; }
      for (const [k, nom, i] of PRIERES) {
        if (!actives.includes(k)) continue;
        if (H.t[i] !== H.min) continue;
        const cle = `${H.jour}|${k}`;
        if (row.dernier === cle) continue;
        const titre = k === "dhuhr" && H.vendredi ? `🕌 Joumouʿa — ${hm(H.t[i])}` : `🕌 ${nom} — ${hm(H.t[i])}`;
        // 📖 un verset court (Hamidullah) avec chaque adhan, différent à chaque prière et chaque jour
        const vs = (await quotidien())?.[H.jour]?.v?.[PRIERES.findIndex((p) => p[0] === k)];
        const corps = "C'est l'heure de la prière. Qu'Allah l'accepte. 🤲" + (vs ? `\n📖 « ${vs[0]} » — ${vs[1]}` : "");
        const ok = await envoyer(row, { title: titre, body: corps, tag: "priere-" + k, url: params.url || "./" });
        if (ok) parType.priere++;
        await sb.from("niyya_push").update({ dernier: cle, envoye_le: new Date().toISOString() }).eq("endpoint", row.endpoint);
        if (ok) envoyes++;
      }
      for (const [q, minute, champ] of RAPPELS) {
        if (params[champ] === false || H.min !== minute) continue;
        const cleq = `${H.jour}|${q}`;
        if (row.dernier_q === cleq) continue;
        const x = (await quotidien())?.[H.jour];
        if (!x) continue;
        const payload = q === "h"
          ? { title: "📜 Hadith du jour", body: `« ${x.h[0]} »\n— ${x.h[1]}`, tag: "hadith", url: params.url || "./" }
          : { title: "💡 Mindset du jour", body: `« ${x.m[0]} »\n— ${x.m[1]}`, tag: "mindset", url: params.url || "./" };
        const ok = await envoyer(row, payload);
        if (ok) parType[q === "h" ? "hadith" : "mindset"]++;
        await sb.from("niyya_push").update({ dernier_q: cleq }).eq("endpoint", row.endpoint);
        if (ok) envoyes++;
      }
      if (H.dimanche && H.min === 20 * 60 && params.recap !== false && row.user_id && row.dernier_q !== `${H.jour}|s`) {
        try {
          const r = await recap(row.user_id, H.jour);
          if (r && await envoyer(row, { ...r, url: params.url || "./" })) { envoyes++; parType.recap++; }
        } catch (e) { console.error("recap", e); }
        await sb.from("niyya_push").update({ dernier_q: `${H.jour}|s` }).eq("endpoint", row.endpoint);
      }
    }
    for (const [t, n] of Object.entries(parType)) if (n) await sb.rpc("niyya_compter_envoi", { p_type: t, p_n: n });
    return rep({ ok: true, abonnes: (subs || []).length, envoyes });
  }

  if (action === "test") {
    const { data: row } = await sb.from("niyya_push").select("endpoint, sub, params").eq("endpoint", body.endpoint || "").maybeSingle();
    if (!row) return rep({ erreur: "abonnement introuvable" }, 404);
    let prochaine = "";
    try { const H = horaires(row.params || {}, new Date()); const n = PRIERES.find((p) => H.t[p[2]] > H.min); prochaine = n ? ` Prochaine : ${n[1]} à ${hm(H.t[n[2]])}.` : ""; } catch { /* */ }
    const ok = await envoyer(row, { title: "🔔 NIYYA — notifications activées", body: "Tu seras prévenu à l'heure de chaque adhan." + prochaine, tag: "test", url: (row.params || {}).url || "./" });
    return rep({ ok });
  }

  if (action === "broadcast") {
    const cle = String(body.cle || "");
    if (cle.length < 32) return rep({ erreur: "lien invalide" }, 403);
    const { data: acces } = await sb.from("niyya_admin_acces").select("empreinte").eq("empreinte", await sha256hex(cle)).maybeSingle();
    if (!acces) return rep({ erreur: "lien invalide" }, 403);
    const titre = String(body.titre || "NIYYA").slice(0, 80), message = String(body.message || "").slice(0, 300);
    if (!message) return rep({ erreur: "message vide" }, 400);
    const { data: subs } = await sb.from("niyya_push").select("endpoint, sub, params").eq("actif", true);
    let ok = 0;
    for (const row of subs || []) if (await envoyer(row, { title: titre, body: message, tag: "annonce-" + Date.now(), url: (row.params || {}).url || "./" })) ok++;
    if (ok) await sb.rpc("niyya_compter_envoi", { p_type: "annonce", p_n: ok });
    await sb.from("niyya_push_annonces").insert({ titre, message, envoyes: ok, abonnes: (subs || []).length });
    return rep({ ok: true, abonnes: (subs || []).length, envoyes: ok });
  }

  // Outils administrateur (lien secret du back-office) : lister les abonnements, envoyer un rappel d'essai à UN abonnement
  if (action === "abonnes" || action === "essai") {
    const cle = String(body.cle || "");
    if (cle.length < 32) return rep({ erreur: "lien invalide" }, 403);
    const { data: acces } = await sb.from("niyya_admin_acces").select("empreinte").eq("empreinte", await sha256hex(cle)).maybeSingle();
    if (!acces) return rep({ erreur: "lien invalide" }, 403);
    const { data: subs } = await sb.from("niyya_push").select("endpoint, sub, params, user_id, maj_le").eq("actif", true).order("maj_le", { ascending: false });
    if (action === "abonnes") return rep((subs || []).map((r: any) => ({ fin: r.endpoint.slice(-12), user_id: r.user_id, maj_le: r.maj_le, tz: r.params?.tz, hsc: r.params?.hsc })));
    const row = (subs || []).find((r: any) => r.endpoint.endsWith(String(body.fin || "\u0000")));
    if (!row) return rep({ erreur: "abonnement introuvable" }, 404);
    if (body.type === "p") {
      const H = horaires(row.params || {}, new Date()); const i = Math.max(0, PRIERES.findIndex((q) => H.t[q[2]] > H.min));
      const vs = (await quotidien())?.[H.jour]?.v?.[i];
      return rep({ ok: await envoyer(row, { title: `🧪 ESSAI — ${PRIERES[i][1]} à ${hm(H.t[PRIERES[i][2]])}`, body: "C'est l'heure de la prière. Qu'Allah l'accepte. 🤲" + (vs ? `\n📖 « ${vs[0]} » — ${vs[1]}` : ""), tag: "priere-" + PRIERES[i][0], url: row.params?.url || "./" }) });
    }
    if (body.type === "s") {
      if (!row.user_id) return rep({ erreur: "abonnement pas encore rattaché à un compte" }, 409);
      const r = await recap(row.user_id, horaires(row.params || {}, new Date()).jour);
      return rep(r ? { ok: await envoyer(row, { ...r, url: row.params?.url || "./" }) } : { erreur: "aucune journée cette semaine" });
    }
    const x = (await quotidien())?.[horaires(row.params || {}, new Date()).jour];
    if (!x) return rep({ erreur: "contenu du jour introuvable" }, 500);
    const payload = body.type === "h"
      ? { title: "📜 Hadith du jour", body: `« ${x.h[0]} »\n— ${x.h[1]}`, tag: "hadith", url: row.params?.url || "./" }
      : { title: "💡 Mindset du jour", body: `« ${x.m[0]} »\n— ${x.m[1]}`, tag: "mindset", url: row.params?.url || "./" };
    return rep({ ok: await envoyer(row, payload) });
  }

  return rep({ erreur: "action inconnue" }, 400);
});
