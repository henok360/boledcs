import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSetupStatus } from "@/lib/dcs.functions";
import { usernameToEmail } from "@/lib/dcs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — Cafeteria Digital Coupon System" },
      {
        name: "description",
        content:
          "Sign in to the office cafeteria Digital Coupon System to view your weekly meal balance, generate coupon codes, or serve at the counter.",
      },
      { property: "og:title", content: "Sign in — Cafeteria Digital Coupon System" },
      {
        property: "og:description",
        content: "Paperless meal coupons for the office cafeteria: weekly balances, scannable codes, instant records.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const setupStatus = useServerFn(getSetupStatus);
  const { data: setup } = useQuery({ queryKey: ["setup-status"], queryFn: () => setupStatus({}) });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (username.trim().length < 3 || password.length < 6) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    setBusy(false);
    if (signInError) {
      setError("Username or password is incorrect.");
      return;
    }
    navigate({ to: "/app", replace: true });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="brand-surface flex flex-col justify-between p-8 lg:p-14">
        <p className="text-xs uppercase tracking-[0.3em] opacity-75">Office Cafeteria</p>
        <div className="max-w-md py-14">
          <h1 className="font-display text-4xl leading-tight font-semibold lg:text-5xl">
            Meal coupons, without the paper.
          </h1>
          <p className="mt-5 text-base opacity-85">
            200 Birr a week, Monday to Friday. Pick how much you want to spend, show the code at the counter, and it is
            deducted the moment it is scanned.
          </p>
          <ul className="mt-8 space-y-2 text-sm opacity-85">
            <li>· Codes for 40, 80, 120, 160 or 200 Birr</li>
            <li>· Every code expires 2 minutes after it appears</li>
            <li>· Counter staff scan with a phone or tablet camera</li>
          </ul>
        </div>
        <p className="text-xs opacity-70">Serving 2,000 employees</p>
      </div>

      <div className="flex items-center justify-center bg-background p-8">
        <form onSubmit={onSubmit} className="panel w-full max-w-sm space-y-5 p-7">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use the username you were given.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              autoComplete="username"
              maxLength={40}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              maxLength={72}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          {setup?.needsSetup ? (
            <p className="text-center text-sm text-muted-foreground">
              No accounts exist yet.{" "}
              <Link to="/setup" className="font-medium text-primary underline">
                Create the first Super Admin
              </Link>
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
