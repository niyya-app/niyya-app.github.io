-- =====================================================================
-- NIYYA — notifications push (abonnements + envoi chaque minute)
-- =====================================================================
create table if not exists public.niyya_push (
  endpoint   text primary key,
  sub        jsonb not null,
  params     jsonb not null default '{}'::jsonb,
  user_id    uuid,
  actif      boolean not null default true,
  dernier    text,
  envoye_le  timestamptz,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  constraint niyya_push_taille check (pg_column_size(sub) < 4000 and pg_column_size(params) < 4000)
);
alter table public.niyya_push enable row level security;
revoke all on public.niyya_push from anon, authenticated;

create table if not exists public.niyya_push_cles (id int primary key check (id = 1), publique text not null, privee text not null, cree_le timestamptz default now());
alter table public.niyya_push_cles enable row level security;
revoke all on public.niyya_push_cles from anon, authenticated;

create table if not exists public.niyya_push_annonces (
  id bigserial primary key, titre text, message text, envoyes int, abonnes int, cree_le timestamptz default now()
);
alter table public.niyya_push_annonces enable row level security;
revoke all on public.niyya_push_annonces from anon, authenticated;

-- Abonnement (appelé par l'appli après « Activer les notifications »)
create or replace function public.niyya_push_abonner(p_sub jsonb, p_params jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare e text := p_sub->>'endpoint';
begin
  if e is null or e !~ '^https://' or length(e) > 1000 or p_sub->'keys'->>'p256dh' is null then
    raise exception 'Abonnement invalide';
  end if;
  insert into public.niyya_push (endpoint, sub, params, user_id, actif, maj_le)
  values (e, p_sub, coalesce(p_params,'{}'::jsonb), auth.uid(), true, now())
  on conflict (endpoint) do update set sub = excluded.sub, params = excluded.params,
    user_id = coalesce(excluded.user_id, public.niyya_push.user_id), actif = true, maj_le = now();
end $$;

create or replace function public.niyya_push_desabonner(p_endpoint text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.niyya_push set actif = false, maj_le = now() where endpoint = p_endpoint;
end $$;

revoke all on function public.niyya_push_abonner(jsonb, jsonb), public.niyya_push_desabonner(text) from public;
grant execute on function public.niyya_push_abonner(jsonb, jsonb), public.niyya_push_desabonner(text) to anon, authenticated;

-- Envoi chaque minute : pg_cron appelle la fonction « niyya-push »
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('niyya-push-minute') where exists (select 1 from cron.job where jobname = 'niyya-push-minute');
select cron.schedule('niyya-push-minute', '* * * * *', $cron$
  select net.http_post(
    url := 'https://acalynsfttpchvnomjwb.supabase.co/functions/v1/niyya-push',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000
  );
$cron$);

select 'Notifications prêtes' as etat;
grant select, insert, update, delete on public.niyya_push, public.niyya_push_cles, public.niyya_push_annonces to service_role;
grant select on public.niyya_admin_acces to service_role;
grant usage, select on sequence public.niyya_push_annonces_id_seq to service_role;
select 'Accès serveur OK' as etat;
