REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.dcs_week_start(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dcs_week_start(timestamptz) TO authenticated, service_role;