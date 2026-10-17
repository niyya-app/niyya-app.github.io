-- =====================================================================
-- NIYYA — back-office administrateur (https://niyya-app.github.io/admin.html)
-- Lecture réservée au compte hestia14000@gmail.com. Aucune donnée de contenu
-- (prières, cigarettes, poids…) n'est exposée : uniquement des comptes et des totaux.
-- =====================================================================

-- 1) Le compteur anonyme accepte aussi : utilisateur actif du jour, lancement depuis l'icône / depuis le navigateur
create or replace function public.niyya_compter(p_onglet text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_onglet not in ('jour','din','noms','coran','qibla','tabac','voyage','bilan','reglages','don',
                      'actif','lancement_appli','lancement_web','citadelle','notif_msg','notif_cache','notif_url') then return; end if;
  insert into public.niyya_stats (jour, onglet, nb) values ((now() at time zone 'Europe/Paris')::date, p_onglet, 1)
  on conflict (jour, onglet) do update set nb = public.niyya_stats.nb + 1;
end $$;

-- 2) Données du tableau de bord (fonction interne, jamais appelable directement)
create or replace function public.niyya_admin_data()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare aujourd date := (now() at time zone 'Europe/Paris')::date;
begin
  return jsonb_build_object(
    'maj', to_char(now() at time zone 'Europe/Paris','DD/MM/YYYY HH24:MI'),
    'comptes', (select count(*) from auth.users),
    'questionnaire_fini', (select count(*) from public.niyya_profils p where coalesce((p.data->>'onb')::boolean,false)),
    'nouveaux_7j', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'actifs_1j',  (select count(distinct user_id) from public.niyya_jours where updated_at > now() - interval '1 day'),
    'actifs_7j',  (select count(distinct user_id) from public.niyya_jours where updated_at > now() - interval '7 days'),
    'actifs_30j', (select count(distinct user_id) from public.niyya_jours where updated_at > now() - interval '30 days'),
    'inscriptions', coalesce((select jsonb_agg(jsonb_build_object('jour', d::date, 'nb',
        (select count(*) from auth.users u where (u.created_at at time zone 'Europe/Paris')::date = d::date)) order by d)
      from generate_series(aujourd - 29, aujourd, interval '1 day') d), '[]'::jsonb),
    'quotidien', coalesce((select jsonb_agg(jsonb_build_object('jour', d::date,
        'actifs', coalesce((select nb from public.niyya_stats s where s.jour = d::date and s.onglet = 'actif'),0),
        'appli',  coalesce((select nb from public.niyya_stats s where s.jour = d::date and s.onglet = 'lancement_appli'),0),
        'web',    coalesce((select nb from public.niyya_stats s where s.jour = d::date and s.onglet = 'lancement_web'),0),
        'clics',  coalesce((select sum(nb) from public.niyya_stats s where s.jour = d::date and s.onglet not in ('actif','lancement_appli','lancement_web')),0)) order by d)
      from generate_series(aujourd - 29, aujourd, interval '1 day') d), '[]'::jsonb),
    'onglets', coalesce((select jsonb_agg(x order by x->>'j30' desc) from (
        select jsonb_build_object('onglet', onglet,
          'aujourdhui', coalesce(sum(nb) filter (where jour = aujourd),0),
          'j7',  coalesce(sum(nb) filter (where jour > aujourd - 7),0),
          'j30', coalesce(sum(nb) filter (where jour > aujourd - 30),0)) x
        from public.niyya_stats where onglet not in ('actif','lancement_appli','lancement_web') group by onglet) t), '[]'::jsonb),
    'villes', coalesce((select jsonb_agg(jsonb_build_object('ville', v, 'nb', n) order by n desc) from (
        select regexp_replace(coalesce(p.data->'lieu'->>'nom','—'),'\s*\(\d+\)$','') v, count(*) n
        from public.niyya_profils p group by 1 order by 2 desc limit 15) t), '[]'::jsonb),
    'utilisateurs', coalesce((select jsonb_agg(jsonb_build_object(
        'prenom', coalesce(p.data->>'nom','—'),
        'email', u.email,
        'inscrit', to_char(u.created_at at time zone 'Europe/Paris','DD/MM/YY HH24:MI'),
        'questionnaire', coalesce((p.data->>'onb')::boolean,false),
        'ville', regexp_replace(coalesce(p.data->'lieu'->>'nom','—'),'\s*\(\d+\)$',''),
        'jours', (select count(*) from public.niyya_jours j where j.user_id = u.id),
        'derniere', (select to_char(max(j.updated_at) at time zone 'Europe/Paris','DD/MM/YY HH24:MI') from public.niyya_jours j where j.user_id = u.id)
      ) order by u.created_at desc) from auth.users u left join public.niyya_profils p on p.user_id = u.id), '[]'::jsonb)
  );
end $$;

-- 3) Accès par compte administrateur (e-mail + mot de passe)
create or replace function public.niyya_admin()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if coalesce(auth.jwt()->>'email','') <> 'hestia14000@gmail.com' then
    raise exception 'Réservé à l''administrateur' using errcode = '42501';
  end if;
  return public.niyya_admin_data();
end $$;

-- 4) Accès par LIEN SECRET (#k=…) : seule l'empreinte SHA-256 de la clé est stockée, jamais la clé
create table if not exists public.niyya_admin_acces (empreinte text primary key, libelle text, cree_le timestamptz default now());
alter table public.niyya_admin_acces enable row level security;
revoke all on public.niyya_admin_acces from anon, authenticated;
insert into public.niyya_admin_acces (empreinte, libelle) values ('35dc5e8339b2d1d1a3cfdbf785a752c507c5be2c6e187c981c27120118ba3456', 'Lien back-office de Mehdi du 15/10/2026') on conflict do nothing;

create or replace function public.niyya_admin_lien(p_cle text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if p_cle is null or length(p_cle) < 32
     or not exists (select 1 from public.niyya_admin_acces a where a.empreinte = encode(sha256(convert_to(p_cle,'UTF8')),'hex')) then
    raise exception 'Lien d''accès invalide' using errcode = '42501';
  end if;
  return public.niyya_admin_data();
end $$;

revoke all on function public.niyya_admin_data() from public, anon, authenticated;
revoke all on function public.niyya_admin(), public.niyya_admin_lien(text) from public, anon;
grant execute on function public.niyya_admin() to authenticated;
grant execute on function public.niyya_admin_lien(text) to anon, authenticated;

select 'Back-office prêt' as etat;
