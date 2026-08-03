export const AUTH_STORE = Symbol('AUTH_STORE');
export const AUTH_RATE_LIMITER = Symbol('AUTH_RATE_LIMITER');
export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');

/**
 * Canonical step-up action-class value.
 *
 * Step-up grants are consumed by the RbacGuard, which looks up
 * `admin_step_up_grants.action_class` using the canonical (lowercase)
 * catalog permission code (for example `admin.user.manage`). Every value
 * written to or compared against that column is normalized through this
 * single function, so grant creation and grant consumption can never
 * diverge by case. Legacy callers that historically sent UPPER_CASE
 * purpose-style codes (for example `ADMIN_MFA_RESET`) are accepted and
 * normalized to their canonical catalog form (`admin.mfa.reset`).
 */
export function normalizeActionClass(value: string): string {
  return value.trim().toLowerCase();
}
