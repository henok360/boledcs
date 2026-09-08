import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createFirstSuperAdmin, getSetupStatus } from "@/lib/dcs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "First-time setup — Cafeteria Digital Coupon System" },
      {
        name: "description",
        content: "Create the first Super Admin account for the cafeteria Digital Coupon System.",
      },
      { property: "og:title", content: "First-time setup — Cafeteria Digital Coupon System" },
      { property: "og:description", content: "Bootstrap the cafeteria coupon system with its first Super Admin." },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const status = useServerFn(getSetupStatus);
  const create = useServerFn(createFirstSuperAdmin);
  const { data: setup, isLoading } = useQuery({ queryKey: ["setup-status"], queryFn: () => status({}) });

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => create({ data: { username, fullName: fullName || undefined, password } }),
    onSuccess: () => navigate({ to: "/", replace: true }),
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters for the password.");
    if (password !== confirm) return setError("The two passwords do not match.");
    mutation.mutate();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="panel w-full max-w-md p-7">
        <h1 className="font-display text-2xl font-semibold text-foreground">First-time setup</h1>
        {isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Checking…</p>
        ) : setup && !setup.needsSetup ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-muted-foreground">
              A Super Admin already exists, so setup is closed. Sign in instead.
            </p>
            <Button onClick={() => navigate({ to: "/" })}>Go to sign in</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              This account can create all other accounts and approve weekly allowances.
            </p>
            <div className="space-y-2">
              <Label htmlFor="su-username">Username</Label>
              <Input id="su-username" value={username} maxLength={40} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="su-name">Full name (optional)</Label>
              <Input id="su-name" value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="su-pass">Password</Label>
              <Input
                id="su-pass"
                type="password"
                value={password}
                maxLength={72}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="su-pass2">Repeat password</Label>
              <Input
                id="su-pass2"
                type="password"
                value={confirm}
                maxLength={72}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create Super Admin"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
