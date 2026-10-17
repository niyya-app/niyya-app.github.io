-- NIYYA — récap de la semaine : la fonction d'envoi lit les journées de l'abonné (pour lui seul)
grant select on public.niyya_jours, public.niyya_profils to service_role;
select 'Récap prêt' as etat;
