export const COUPON_AMOUNTS = [40, 80, 120, 160, 200] as const;
export const DAILY_AMOUNT = 40;
export const WEEKLY_ALLOWANCE = 200;
export const TOKEN_TTL_SECONDS = 120;

export type RoleName = "super_admin" | "cashier" | "auditor" | "employee";

export const ROLE_LABELS: Record<RoleName, string> = {
  super_admin: "Super Admin",
  cashier: "Cashier",
  auditor: "Auditor",
  employee: "Employee",
};

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@dcs.local`;
}

/** Monday of the week containing the given date, as YYYY-MM-DD. */
export function weekStart(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function isServiceDay(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function birr(amount: number): string {
  return `${amount.toLocaleString("en-US")} Birr`;
}

export function homePathForRoles(roles: RoleName[]): string {
  if (roles.includes("super_admin")) return "/admin";
  if (roles.includes("cashier")) return "/cashier";
  if (roles.includes("auditor")) return "/audit";
  return "/employee";
}
