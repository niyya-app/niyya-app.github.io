-- NIYYA : exclure des statistiques le compte de Mehdi, le compte démo Apple et le vérificateur Apple (30/10/2026) + demandes de mosquée
-- À coller dans Supabase > SQL Editor > Run. Ne touche à aucune donnée : remplace seulement 3 fonctions.
create or replace function public.niyya_admin_data()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare aujourd date := (now() at time zone 'Europe/Paris')::date;
        exclus uuid[] := array(select id from auth.users where email in ('hestia14000@gmail.com','contact.nyya@gmail.com','contact.nyya+apple@gmail.com','luis.p24g38b.bh3e8@icloud.com')); -- Mehdi, compte démo, vérificateur Apple : hors statistiques
begin
  return jsonb_build_object(
    'maj', to_char(now() at time zone 'Europe/Paris','DD/MM/YYYY HH24:MI'),
    'comptes', (select count(*) from auth.users where coalesce(id <> all(exclus), true)),
    'questionnaire_fini', (select count(*) from public.niyya_profils p where coalesce((p.data->>'onb')::boolean,false) and coalesce(p.user_id <> all(exclus), true)),
    'nouveaux_7j', (select count(*) from auth.users where created_at > now() - interval '7 days' and coalesce(id <> all(exclus), true)),
    'actifs_1j',  (select count(distinct user_id) from public.niyya_jours where updated_at > now() - interval '1 day' and coalesce(user_id <> all(exclus), true)),
    'actifs_7j',  (select count(distinct user_id) from public.niyya_jours where updated_at > now() - interval '7 days' and coalesce(user_id <> all(exclus), true)),
    'actifs_30j', (select count(distinct user_id) from public.niyya_jours where updated_at > now() - interval '30 days' and coalesce(user_id <> all(exclus), true)),
    'inscriptions', coalesce((select jsonb_agg(jsonb_build_object('jour', d::date, 'nb',
        (select count(*) from auth.users u where (u.created_at at time zone 'Europe/Paris')::date = d::date and coalesce(u.id <> all(exclus), true))) order by d)
      from generate_series(aujourd - 29, aujourd, interval '1 day') d), '[]'::jsonb),
    'quotidien', coalesce((select jsonb_agg(jsonb_build_object('jour', d::date,
        'actifs', coalesce((select nb from public.niyya_stats s where s.jour = d::date and s.onglet = 'actif'),0),
        'appli',  coalesce((select nb from public.niyya_stats s where s.jour = d::date and s.onglet = 'lancement_appli'),0),
        'web',    coalesce((select nb from public.niyya_stats s where s.jour = d::date and s.onglet = 'lancement_web'),0),
        'clics',  coalesce((select sum(nb) from public.niyya_stats s where s.jour = d::date and s.onglet not in ('actif','lancement_appli','lancement_web') and s.onglet !~ '^(envoi|ouvert|notif)_'),0)) order by d)
      from generate_series(aujourd - 29, aujourd, interval '1 day') d), '[]'::jsonb),
    'onglets', coalesce((select jsonb_agg(x order by x->>'j30' desc) from (
        select jsonb_build_object('onglet', onglet,
          'aujourdhui', coalesce(sum(nb) filter (where jour = aujourd),0),
          'j7',  coalesce(sum(nb) filter (where jour > aujourd - 7),0),
          'j30', coalesce(sum(nb) filter (where jour > aujourd - 30),0)) x
        from public.niyya_stats where onglet not in ('actif','lancement_appli','lancement_web') and onglet !~ '^(envoi|ouvert|notif)_' group by onglet) t), '[]'::jsonb),
    -- notifications : envoyées / ouvertes par type (anonyme)
    'notifs', coalesce((select jsonb_agg(jsonb_build_object('type', t,
        'envoi_j7',  coalesce((select sum(nb) from public.niyya_stats where onglet = 'envoi_'||t and jour > aujourd - 7),0),
        'ouvert_j7', coalesce((select sum(nb) from public.niyya_stats where onglet = 'ouvert_'||t and jour > aujourd - 7),0),
        'envoi_j30', coalesce((select sum(nb) from public.niyya_stats where onglet = 'envoi_'||t and jour > aujourd - 30),0),
        'ouvert_j30',coalesce((select sum(nb) from public.niyya_stats where onglet = 'ouvert_'||t and jour > aujourd - 30),0)))
      from unnest(array['priere','hadith','mindset','soir','recap','annonce']) t), '[]'::jsonb),
    'robot', (select jsonb_build_object('dernier_tick', to_char(e.dernier_tick at time zone 'Europe/Paris','DD/MM HH24:MI'),
        'minutes', round(extract(epoch from now() - e.dernier_tick)/60), 'envoyes_jour', case when e.jour = aujourd then e.envoyes_jour else 0 end,
        'echecs_jour', case when e.jour = aujourd then e.echecs_jour else 0 end, 'derniere_erreur', e.derniere_erreur) from public.niyya_push_etat e where e.id = 1),
    'abonnes_notifs', (select count(*) from public.niyya_push where actif and coalesce(user_id <> all(exclus), true)),
    'villes', coalesce((select jsonb_agg(jsonb_build_object('ville', v, 'nb', n) order by n desc) from (
        select regexp_replace(coalesce(p.data->'lieu'->>'nom','—'),'\s*\(\d+\)$','') v, count(*) n
        from public.niyya_profils p where coalesce(p.user_id <> all(exclus), true) group by 1 order by 2 desc limit 15) t), '[]'::jsonb),
    'utilisateurs', coalesce((select jsonb_agg(jsonb_build_object(
        'prenom', coalesce(p.data->>'nom','—'),
        'email', u.email,
        'inscrit', to_char(u.created_at at time zone 'Europe/Paris','DD/MM/YY HH24:MI'),
        'questionnaire', coalesce((p.data->>'onb')::boolean,false),
        'ville', regexp_replace(coalesce(p.data->'lieu'->>'nom','—'),'\s*\(\d+\)$',''),
        'jours', (select count(*) from public.niyya_jours j where j.user_id = u.id),
        'derniere', (select to_char(max(j.updated_at) at time zone 'Europe/Paris','DD/MM/YY HH24:MI') from public.niyya_jours j where j.user_id = u.id),
        'notifs', exists(select 1 from public.niyya_push n where n.user_id = u.id and n.actif),
        'id', u.id,
        'code', left(u.id::text, 8),
        'parrain', p.data->>'parrain',
        'mosquee_demande', p.data->'demandeMosquee',
        'icone', coalesce((p.data->>'vuIcone')::boolean, false),
        'jours_inscrit', ((now() at time zone 'Europe/Paris')::date - (u.created_at at time zone 'Europe/Paris')::date),
        -- fidélité : revenu le lendemain de l'inscription / encore actif 7 jours après (null si trop récent)
        'j1', case when (now() at time zone 'Europe/Paris')::date > (u.created_at at time zone 'Europe/Paris')::date + 1
                then exists(select 1 from public.niyya_jours j where j.user_id = u.id and j.jour = (u.created_at at time zone 'Europe/Paris')::date + 1) end,
        'j7', case when (now() at time zone 'Europe/Paris')::date > (u.created_at at time zone 'Europe/Paris')::date + 7
                then exists(select 1 from public.niyya_jours j where j.user_id = u.id and j.jour >= (u.created_at at time zone 'Europe/Paris')::date + 7) end
      ) order by u.created_at desc) from auth.users u left join public.niyya_profils p on p.user_id = u.id where coalesce(u.id <> all(exclus), true)), '[]'::jsonb)
  );
end $$;

create or replace function public.niyya_admin()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if coalesce(auth.jwt()->>'email','') <> 'hestia14000@gmail.com' then
    raise exception 'Réservé à l''administrateur' using errcode = '42501';
  end if;
  return public.niyya_admin_data() || jsonb_build_object('genres', jsonb_build_object('h', (select count(*) from public.niyya_profils p join auth.users u on u.id = p.user_id where p.data->>'genre'='h' and u.email not in ('hestia14000@gmail.com','contact.nyya@gmail.com','contact.nyya+apple@gmail.com','luis.p24g38b.bh3e8@icloud.com')), 'f', (select count(*) from public.niyya_profils p join auth.users u on u.id = p.user_id where p.data->>'genre'='f' and u.email not in ('hestia14000@gmail.com','contact.nyya@gmail.com','contact.nyya+apple@gmail.com','luis.p24g38b.bh3e8@icloud.com')))); -- totaux hommes / femmes uniquement
end $$;

create or replace function public.niyya_admin_lien(p_cle text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if p_cle is null or length(p_cle) < 32
     or not exists (select 1 from public.niyya_admin_acces a where a.empreinte = encode(sha256(convert_to(p_cle,'UTF8')),'hex')) then
    raise exception 'Lien d''accès invalide' using errcode = '42501';
  end if;
  return public.niyya_admin_data() || jsonb_build_object('genres', jsonb_build_object('h', (select count(*) from public.niyya_profils p join auth.users u on u.id = p.user_id where p.data->>'genre'='h' and u.email not in ('hestia14000@gmail.com','contact.nyya@gmail.com','contact.nyya+apple@gmail.com','luis.p24g38b.bh3e8@icloud.com')), 'f', (select count(*) from public.niyya_profils p join auth.users u on u.id = p.user_id where p.data->>'genre'='f' and u.email not in ('hestia14000@gmail.com','contact.nyya@gmail.com','contact.nyya+apple@gmail.com','luis.p24g38b.bh3e8@icloud.com')))); -- totaux hommes / femmes uniquement
end $$;
