-- =====================================================================
-- NIYYA — synchronisation INCRÉMENTALE (économise le trafic, offre gratuite)
-- Ne renvoie que les journées modifiées depuis p_depuis (+ le profil s'il a changé).
-- =====================================================================
create index if not exists niyya_jours_maj on public.niyya_jours (user_id, updated_at);

create or replace function public.niyya_lire_depuis(p_depuis timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.niyya_moi();
begin
  return jsonb_build_object(
    'jours',  coalesce((select jsonb_object_agg(j.jour::text, j.data) from public.niyya_jours j
                        where j.user_id = u and (p_depuis is null or j.updated_at > p_depuis)), '{}'::jsonb),
    'config', (select p.data from public.niyya_profils p where p.user_id = u and (p_depuis is null or p.updated_at > p_depuis)),
    'maintenant', now()
  );
end $$;

revoke all on function public.niyya_lire_depuis(timestamptz) from public, anon;
grant execute on function public.niyya_lire_depuis(timestamptz) to authenticated;

select 'Synchro incrémentale prête' as etat;
