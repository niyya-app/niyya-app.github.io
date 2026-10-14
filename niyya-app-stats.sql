-- =====================================================================
-- NIYYA — compteur ANONYME d'ouverture des onglets (projet niyya)
-- On ne stocke que : le jour, le nom de l'onglet, un nombre. Aucun identifiant d'utilisateur.
-- Lecture réservée au compte administrateur (Mehdi).
-- =====================================================================

create table if not exists public.niyya_stats (
  jour    date not null,
  onglet  text not null,
  nb      integer not null default 0,
  primary key (jour, onglet)
);
alter table public.niyya_stats enable row level security;
revoke all on public.niyya_stats from anon, authenticated;

create or replace function public.niyya_compter(p_onglet text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_onglet not in ('jour','din','noms','coran','qibla','tabac','voyage','bilan','reglages','don') then return; end if;
  insert into public.niyya_stats (jour, onglet, nb) values ((now() at time zone 'Europe/Paris')::date, p_onglet, 1)
  on conflict (jour, onglet) do update set nb = public.niyya_stats.nb + 1;
end $$;

create or replace function public.niyya_stats_lire(p_jours integer default 30)
returns table(onglet text, total bigint, aujourdhui bigint, sept_jours bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.jwt()->>'email','') <> 'hestia14000@gmail.com' then
    raise exception 'Réservé à l''administrateur' using errcode = '42501';
  end if;
  return query
    select s.onglet,
           sum(s.nb)::bigint,
           coalesce(sum(s.nb) filter (where s.jour = (now() at time zone 'Europe/Paris')::date),0)::bigint,
           coalesce(sum(s.nb) filter (where s.jour > (now() at time zone 'Europe/Paris')::date - 7),0)::bigint
    from public.niyya_stats s
    where s.jour > (now() at time zone 'Europe/Paris')::date - p_jours
    group by s.onglet order by 2 desc;
end $$;

revoke all on function public.niyya_compter(text), public.niyya_stats_lire(integer) from public, anon;
grant execute on function public.niyya_compter(text), public.niyya_stats_lire(integer) to authenticated;

select 'Compteur prêt' as etat;
