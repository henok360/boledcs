import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COUPON_AMOUNTS,
  TOKEN_TTL_SECONDS,
  isServiceDay,
  usernameToEmail,
  weekStart,
  type RoleName,
} from "@/lib/dcs";

const usernameRule = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore only");

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertRole(supabase: any, userId: string, role: RoleName) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: role });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have permission to do this");
  return true;
}

/* ---------------- bootstrap ---------------- */

export const getSetupStatus = createServerFn({ method: "GET" }).handler(async () => {
  const db = await admin();
  const { count } = await db
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin");
  return { needsSetup: (count ?? 0) === 0 };
});

export const createFirstSuperAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        username: usernameRule,
        fullName: z.string().trim().max(120).optional(),
        password: z.string().min(8).max(72),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { count } = await db
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin");
    if ((count ?? 0) > 0) throw new Error("A Super Admin already exists");

    const { data: created, error } = await db.auth.admin.createUser({
      email: usernameToEmail(data.username),
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Could not create account");

    await db.from("profiles").insert({
      id: created.user.id,
      username: data.username.trim().toLowerCase(),
      full_name: data.fullName ?? null,
      must_reset_password: false,
    });
    await db.from("user_roles").insert({ user_id: created.user.id, role: "super_admin" });
    return { ok: true, username: data.username.trim().toLowerCase() };
  });

/* ---------------- session info ---------------- */

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("username, full_name, must_reset_password").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    return {
      userId,
      username: profile?.username ?? "",
      fullName: profile?.full_name ?? null,
      mustResetPassword: profile?.must_reset_password ?? false,
      roles: (roles ?? []).map((r: { role: RoleName }) => r.role) as RoleName[],
    };
  });

export const clearPasswordResetFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ must_reset_password: false })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- super admin ---------------- */

export const bulkCreateAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        role: z.enum(["employee", "cashier", "auditor"]),
        accounts: z
          .array(
            z.object({
              username: usernameRule,
              fullName: z.string().trim().max(120).optional(),
              password: z.string().min(8).max(72),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId, "super_admin");
    const db = await admin();
    const created: string[] = [];
    const failed: { username: string; reason: string }[] = [];

    for (const acc of data.accounts) {
      const username = acc.username.trim().toLowerCase();
      const { data: made, error } = await db.auth.admin.createUser({
        email: usernameToEmail(username),
        password: acc.password,
        email_confirm: true,
      });
      if (error || !made.user) {
        failed.push({ username, reason: error?.message ?? "Could not create account" });
        continue;
      }
      const { error: pErr } = await db.from("profiles").insert({
        id: made.user.id,
        username,
        full_name: acc.fullName ?? null,
        must_reset_password: true,
      });
      if (pErr) {
        await db.auth.admin.deleteUser(made.user.id);
        failed.push({ username, reason: pErr.message });
        continue;
      }
      await db.from("user_roles").insert({ user_id: made.user.id, role: data.role });
      created.push(username);
    }
    return { created, failed };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertRole(context.supabase, context.userId, "super_admin");
    const db = await admin();
    const week = weekStart();

    const [{ data: profiles }, { data: roles }, { data: allocations }] = await Promise.all([
      db.from("profiles").select("id, username, full_name, must_reset_password").order("username"),
      db.from("user_roles").select("user_id, role"),
      db.from("weekly_allocations").select("user_id, approved_amount, remaining_amount").eq("week_start", week),
    ]);

    const roleMap = new Map<string, RoleName>();
    (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role as RoleName));
    const allocMap = new Map((allocations ?? []).map((a) => [a.user_id, a]));

    const people = (profiles ?? []).map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      role: roleMap.get(p.id) ?? ("employee" as RoleName),
      mustResetPassword: p.must_reset_password,
      approved: allocMap.get(p.id)?.approved_amount ?? null,
      remaining: allocMap.get(p.id)?.remaining_amount ?? null,
    }));

    return {
      week,
      people,
      counts: {
        employees: people.filter((p) => p.role === "employee").length,
        cashiers: people.filter((p) => p.role === "cashier").length,
        auditors: people.filter((p) => p.role === "auditor").length,
        approvedThisWeek: people.filter((p) => p.role === "employee" && p.approved !== null).length,
      },
    };
  });

export const approveWeeklyAllowance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userIds: z.array(z.string().uuid()).min(1).max(2500),
        amount: z.number().int().refine((v) => COUPON_AMOUNTS.includes(v as 40), "Invalid amount"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId, "super_admin");
    const db = await admin();
    const week = weekStart();

    const { data: existing } = await db
      .from("weekly_allocations")
      .select("id, user_id, approved_amount, remaining_amount")
      .eq("week_start", week)
      .in("user_id", data.userIds);
    const existingMap = new Map((existing ?? []).map((e) => [e.user_id, e]));

    let inserted = 0;
    let updated = 0;
    for (const userId of data.userIds) {
      const row = existingMap.get(userId);
      if (row) {
        const spent = row.approved_amount - row.remaining_amount;
        const remaining = Math.max(0, data.amount - spent);
        await db
          .from("weekly_allocations")
          .update({ approved_amount: data.amount, remaining_amount: remaining, approved_by: context.userId })
          .eq("id", row.id);
        updated++;
      } else {
        await db.from("weekly_allocations").insert({
          user_id: userId,
          week_start: week,
          approved_amount: data.amount,
          remaining_amount: data.amount,
          approved_by: context.userId,
        });
        inserted++;
      }
    }
    return { week, inserted, updated };
  });

/* ---------------- employee ---------------- */

export const getEmployeeDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const week = weekStart();
    const nowIso = new Date().toISOString();

    const [{ data: alloc }, { data: pending }, { data: txns }] = await Promise.all([
      supabase
        .from("weekly_allocations")
        .select("approved_amount, remaining_amount")
        .eq("user_id", userId)
        .eq("week_start", week)
        .maybeSingle(),
      supabase
        .from("coupon_tokens")
        .select("amount")
        .eq("user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", nowIso),
      supabase
        .from("transactions")
        .select("id, amount, created_at")
        .eq("employee_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const held = (pending ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
    return {
      week,
      approved: alloc?.approved_amount ?? 0,
      remaining: alloc?.remaining_amount ?? 0,
      held,
      available: Math.max(0, (alloc?.remaining_amount ?? 0) - held),
      serviceDay: isServiceDay(),
      transactions: txns ?? [],
    };
  });

export const generateCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ amount: z.number().int().refine((v) => COUPON_AMOUNTS.includes(v as 40), "Invalid amount") })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!isServiceDay()) throw new Error("The cafeteria only serves Monday to Friday");

    const week = weekStart();
    const nowIso = new Date().toISOString();

    const { data: alloc } = await supabase
      .from("weekly_allocations")
      .select("remaining_amount")
      .eq("user_id", userId)
      .eq("week_start", week)
      .maybeSingle();
    if (!alloc) throw new Error("Your allowance for this week has not been approved yet");

    const { data: pending } = await supabase
      .from("coupon_tokens")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", nowIso);
    const held = (pending ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
    const available = alloc.remaining_amount - held;
    if (data.amount > available) {
      throw new Error(`Only ${available} Birr is available right now`);
    }

    const token = `DCS-${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
    const { error } = await supabase.from("coupon_tokens").insert({
      user_id: userId,
      token,
      amount: data.amount,
      week_start: week,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);
    return { token, amount: data.amount, expiresAt };
  });

/* ---------------- cashier ---------------- */

export const redeemCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().trim().min(6).max(60) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId, "cashier").catch(async () => {
      await assertRole(context.supabase, context.userId, "super_admin");
    });
    const db = await admin();
    const { data: result, error } = await db.rpc("redeem_coupon", {
      _token: data.token.trim(),
      _cashier: context.userId,
    });
    if (error) throw new Error(error.message);
    return result as { ok: boolean; reason?: string; amount?: number; username?: string; remaining?: number };
  });

export const getCashierActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("transactions")
      .select("id, amount, created_at, employee_id")
      .eq("cashier_id", userId)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = data ?? [];
    return {
      count: rows.length,
      total: rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0),
      recent: rows,
    };
  });

/* ---------------- auditor ---------------- */

export const getAuditReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const isAuditor = await supabase
      .rpc("has_role", { _user_id: userId, _role: "auditor" })
      .then((r: { data: boolean | null }) => r.data === true);
    const isAdmin = await supabase
      .rpc("has_role", { _user_id: userId, _role: "super_admin" })
      .then((r: { data: boolean | null }) => r.data === true);
    if (!isAuditor && !isAdmin) throw new Error("You do not have permission to view reports");

    const db = await admin();
    const week = weekStart();

    const [{ data: weekTxns }, { data: allocations }, { data: recent }, { data: profiles }, { data: tokens }] =
      await Promise.all([
        db.from("transactions").select("amount, created_at, employee_id, cashier_id").eq("week_start", week),
        db.from("weekly_allocations").select("approved_amount, remaining_amount").eq("week_start", week),
        db
          .from("transactions")
          .select("id, amount, created_at, employee_id, cashier_id")
          .order("created_at", { ascending: false })
          .limit(60),
        db.from("profiles").select("id, username"),
        db.from("coupon_tokens").select("status, week_start").eq("week_start", week),
      ]);

    const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.username]));
    const byDay = new Map<string, { count: number; total: number }>();
    (weekTxns ?? []).forEach((t) => {
      const key = new Date(t.created_at).toISOString().slice(0, 10);
      const cur = byDay.get(key) ?? { count: 0, total: 0 };
      byDay.set(key, { count: cur.count + 1, total: cur.total + t.amount });
    });

    const approvedTotal = (allocations ?? []).reduce((s, a) => s + a.approved_amount, 0);
    const remainingTotal = (allocations ?? []).reduce((s, a) => s + a.remaining_amount, 0);

    return {
      week,
      approvedTotal,
      remainingTotal,
      redeemedTotal: approvedTotal - remainingTotal,
      redemptionCount: (weekTxns ?? []).length,
      employeesApproved: (allocations ?? []).length,
      tokensIssued: (tokens ?? []).length,
      tokensExpiredOrUnused: (tokens ?? []).filter((t) => t.status !== "redeemed").length,
      byDay: [...byDay.entries()].sort().map(([day, v]) => ({ day, ...v })),
      recent: (recent ?? []).map((r) => ({
        id: r.id,
        amount: r.amount,
        createdAt: r.created_at,
        employee: nameOf.get(r.employee_id) ?? "unknown",
        cashier: r.cashier_id ? nameOf.get(r.cashier_id) ?? "unknown" : "—",
      })),
    };
  });
