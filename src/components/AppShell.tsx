import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type RoleName } from "@/lib/dcs";

export function AppShell({
  title,
  subtitle,
  role,
  username,
  children,
}: {
  title: string;
  subtitle?: string;
  role?: RoleName;
  username?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="brand-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] opacity-75">Digital Coupon System</p>
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm opacity-80">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {username ? (
              <span className="rounded-full bg-white/15 px-3 py-1">
                {username}
                {role ? ` · ${ROLE_LABELS[role]}` : ""}
              </span>
            ) : null}
            <Button variant="secondary" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
