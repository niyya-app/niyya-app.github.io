-- NIYYA — rappels du jour (hadith 8 h, mindset 10 h) : mémoire anti-doublon séparée de celle des prières
alter table public.niyya_push add column if not exists dernier_q text;
grant select, update on public.niyya_push to service_role;
select 'Rappels prêts' as etat;
