grant select, insert, update, delete on public.niyya_push, public.niyya_push_cles, public.niyya_push_annonces to service_role;
grant select on public.niyya_admin_acces to service_role;
grant usage, select on sequence public.niyya_push_annonces_id_seq to service_role;
select 'Accès serveur OK' as etat;
