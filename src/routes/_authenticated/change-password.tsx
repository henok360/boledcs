import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearPasswordResetFlag, getMe } from "@/lib/dcs.functions";
import { homePathForRoles } from "@/lib/dcs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Digital Coupon System" },
      { name: "description", content: "Choose your own password before using your cafeteria coupon account." },
      { property: "og:title", content: "Set a new password — Digital Coupon System" },
      { property: "og:description", content: "First sign-in requires a new password of your own." },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meFn = useServerFn(getMe);
  const clearFlag = useServerFn(clearPasswordResetFlag);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn({}) });

  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const first = me?.mustResetPassword ?? false;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      ...(current ? { current_password: current } : {}),
    } as { password: string });
    if (updateError) {
      setBusy(false);
      setError(updateError.message);
      return;
    }
    await clearFlag({});
    await queryClient.invalidateQueries();
    setBusy(false);
    navigate({ to: homePathForRoles(me?.roles ?? ["employee"]), replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={onSubmit} className="panel w-full max-w-sm space-y-5 p-7">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            {first ? "Choose your own password" : "Change your password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {first
              ? "Your account was created with a temporary password. Pick a new one to continue."
              : "Enter your current password and the new one you want."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cur">{first ? "Temporary password" : "Current password"}</Label>
          <Input id="cur" type="password" value={current} maxLength={72} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new">New password</Label>
          <Input
            id="new"
            type="password"
            value={password}
            maxLength={72}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new2">Repeat new password</Label>
          <Input id="new2" type="password" value={confirm} maxLength={72} onChange={(e) => setConfirm(e.target.value)} />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </Button>
      </form>
    </div>
  );
}
