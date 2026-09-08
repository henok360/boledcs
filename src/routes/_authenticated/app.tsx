import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { getMe } from "@/lib/dcs.functions";
import { homePathForRoles } from "@/lib/dcs";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Opening your dashboard — Digital Coupon System" },
      { name: "description", content: "Taking you to the right cafeteria coupon dashboard for your account." },
      { property: "og:title", content: "Digital Coupon System" },
      { property: "og:description", content: "Paperless meal coupons for the office cafeteria." },
    ],
  }),
  component: RoleRouter,
});

function RoleRouter() {
  const navigate = useNavigate();
  const me = useServerFn(getMe);
  const { data, error } = useQuery({ queryKey: ["me"], queryFn: () => me({}) });

  useEffect(() => {
    if (!data) return;
    if (data.mustResetPassword) {
      navigate({ to: "/change-password", replace: true });
      return;
    }
    navigate({ to: homePathForRoles(data.roles), replace: true });
  }, [data, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">
        {error ? "Could not load your account. Try signing in again." : "Loading your dashboard…"}
      </p>
    </div>
  );
}
