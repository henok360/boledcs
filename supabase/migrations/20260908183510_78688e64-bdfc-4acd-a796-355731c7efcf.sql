CREATE TYPE public.app_role AS ENUM ('super_admin','cashier','auditor','employee');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  full_name text,
  must_reset_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.weekly_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  approved_amount integer NOT NULL DEFAULT 200,
  remaining_amount integer NOT NULL DEFAULT 200,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
GRANT SELECT, INSERT, UPDATE ON public.weekly_allocations TO authenticated;
GRANT ALL ON public.weekly_allocations TO service_role;
ALTER TABLE public.weekly_allocations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.coupon_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  amount integer NOT NULL,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.coupon_tokens TO authenticated;
GRANT ALL ON public.coupon_tokens TO service_role;
ALTER TABLE public.coupon_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cashier_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token_id uuid REFERENCES public.coupon_tokens(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  week_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'cashier'));
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "roles read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'auditor'));

CREATE POLICY "allocations read" ON public.weekly_allocations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'cashier'));
CREATE POLICY "allocations admin write" ON public.weekly_allocations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "allocations admin update" ON public.weekly_allocations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "tokens read" ON public.coupon_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'auditor') OR public.has_role(auth.uid(),'cashier'));
CREATE POLICY "tokens own insert" ON public.coupon_tokens FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "transactions read" ON public.transactions FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR cashier_id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'auditor'));

CREATE OR REPLACE FUNCTION public.dcs_week_start(_ts timestamptz DEFAULT now())
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (date_trunc('week', _ts))::date
$$;

CREATE OR REPLACE FUNCTION public.redeem_coupon(_token text, _cashier uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.coupon_tokens;
  a public.weekly_allocations;
  uname text;
BEGIN
  IF NOT public.has_role(_cashier,'cashier') AND NOT public.has_role(_cashier,'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not authorized to redeem coupons');
  END IF;

  SELECT * INTO t FROM public.coupon_tokens WHERE token = _token FOR UPDATE;
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'Invalid coupon code'); END IF;
  IF t.status = 'redeemed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'This coupon was already used'); END IF;
  IF t.expires_at < now() THEN
    UPDATE public.coupon_tokens SET status = 'expired' WHERE id = t.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon has expired');
  END IF;

  SELECT * INTO a FROM public.weekly_allocations WHERE user_id = t.user_id AND week_start = t.week_start FOR UPDATE;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'No approved allowance for this week'); END IF;
  IF a.remaining_amount < t.amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not enough balance left this week');
  END IF;

  UPDATE public.weekly_allocations SET remaining_amount = remaining_amount - t.amount WHERE id = a.id;
  UPDATE public.coupon_tokens SET status = 'redeemed', redeemed_at = now(), redeemed_by = _cashier WHERE id = t.id;
  INSERT INTO public.transactions (employee_id, cashier_id, token_id, amount, week_start)
  VALUES (t.user_id, _cashier, t.id, t.amount, t.week_start);

  SELECT username INTO uname FROM public.profiles WHERE id = t.user_id;
  RETURN jsonb_build_object('ok', true, 'amount', t.amount, 'username', uname,
    'remaining', a.remaining_amount - t.amount);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_coupon(text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon(text, uuid) TO service_role;