-- =====================================================================
-- NIYYA (version multi-utilisateurs) — projet Supabase « niyya » (organisation NIYYA)
-- Chaque utilisateur se connecte par e-mail + code et ne voit QUE ses données.
-- Les tables ne sont pas exposées : seules les fonctions ci-dessous y accèdent,
-- et toujours pour auth.uid() (l'utilisateur connecté).
-- =====================================================================

create table if not exists public.niyya_jours (
  user_id    uuid not null references auth.users(id) on delete cascade,
  jour       date not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, jour),
  constraint niyya_jours_taille check (pg_column_size(data) < 200000)
);
create table if not exists public.niyya_profils (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  cree_le    timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint niyya_profils_taille check (pg_column_size(data) < 100000)
);
alter table public.niyya_jours   enable row level security;
alter table public.niyya_profils enable row level security;
revoke all on public.niyya_jours, public.niyya_profils from anon, authenticated;

create or replace function public.niyya_moi()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Non connecté' using errcode = '42501'; end if;
  return u;
end $$;

create or replace function public.niyya_lire()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.niyya_moi();
begin
  return jsonb_build_object(
    'jours',  coalesce((select jsonb_object_agg(j.jour::text, j.data) from public.niyya_jours j where j.user_id = u), '{}'::jsonb),
    'config', (select p.data from public.niyya_profils p where p.user_id = u)
  );
end $$;

-- Le plus récent gagne (champ "u" = horodatage de modification côté appareil)
create or replace function public.niyya_ecrire(p_jours jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare u uuid := public.niyya_moi(); n integer;
begin
  if jsonb_typeof(p_jours) <> 'object' then raise exception 'Format invalide'; end if;
  insert into public.niyya_jours (user_id, jour, data, updated_at)
    select u, e.key::date, e.value, now() from jsonb_each(p_jours) e
  on conflict (user_id, jour) do update set data = excluded.data, updated_at = now()
    where coalesce((public.niyya_jours.data->>'u')::bigint, 0) <= coalesce((excluded.data->>'u')::bigint, 0);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.niyya_ecrire_config(p_data jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare u uuid := public.niyya_moi();
begin
  insert into public.niyya_profils (user_id, data, updated_at) values (u, p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
end $$;

-- RGPD : l'utilisateur peut supprimer son compte et toutes ses données
create or replace function public.niyya_supprimer_compte()
returns void language plpgsql volatile security definer set search_path = public, auth as $$
declare u uuid := public.niyya_moi();
begin
  delete from public.niyya_jours where user_id = u;
  delete from public.niyya_profils where user_id = u;
  delete from auth.users where id = u;
end $$;

revoke all on function public.niyya_moi(), public.niyya_lire(), public.niyya_ecrire(jsonb),
  public.niyya_ecrire_config(jsonb), public.niyya_supprimer_compte() from public, anon;
grant execute on function public.niyya_lire(), public.niyya_ecrire(jsonb),
  public.niyya_ecrire_config(jsonb), public.niyya_supprimer_compte() to authenticated;

select 'NIYYA prêt' as etat;
