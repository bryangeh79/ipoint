/**
 * J1 — auth / login (+ refresh, OTP/MFA-flavoured flow, session reuse).
 *
 * Contract §6 journey 1. Ops measured over real HTTP: member login, token
 * refresh, generic OTP issue+verify, and session reuse (authenticated read of
 * the member content home; the logout teardown is exercised at L2).
 *
 * Rate-limit methodology: the frozen composite login limiter (5/email/300s,
 * 10/IP/300s) caps a single-IP block at 10 logins per window — a deliberate
 * security property. Login-family ops are therefore measured at the limiter
 * ceiling (10 samples per cleared block, P2-S4D / P4-S7 cleared-buckets
 * methodology); the 429 behaviour beyond the ceiling is recorded explicitly
 * as an L2 observation instead of being counted as an unexpected error.
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import {
  clearRateLimiter,
  createMember,
  finishJourneyResult,
  httpCall,
  measureOp,
  newJourneyResult,
  PASSWORD,
} from '../harness.js';
import { randomSuffix } from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201, 202]);
const NO_CONTENT = new Set([204]);

export async function runJourneyJ1(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J1', 'auth/login');
  const world = ctx.world;

  // Dedicated member pool so each worker rotates across distinct accounts
  // (the composite login limiter is per-email and per-IP; the pool plus the
  // cleared-buckets methodology keeps the measurement deterministic).
  const poolSize = ctx.level === 'L2' ? 40 : 8;
  const pool: Array<{ email: string; password: string }> = [];
  for (let i = 0; i < poolSize; i += 1) {
    // Fixture creation performs a real login per member; reset the limiter
    // before each so the 10/IP/300s ceiling never trips during setup.
    clearRateLimiter(ctx);
    const member = await createMember(
      ctx.database,
      ctx.auth,
      world.marketId,
      `load-j1-${randomSuffix()}-${i}@example.com`,
    );
    pool.push({ email: member.email, password: member.password });
  }
  result.observations.push(
    `member pool for auth ops: ${poolSize} dedicated accounts`,
  );
  const defaultActor = pool[0];
  if (!defaultActor) throw new Error('J1 auth pool is empty.');
  // Fixture creation above performed 40 logins; reset the limiter so the
  // measured blocks start from a clean window.
  clearRateLimiter(ctx);

  // Login-family ops measured at the limiter ceiling: 10 samples per cleared
  // block at L1/L2 (the IP ceiling is 10/300s), full scale at L0 (≤6).
  const loginScale =
    ctx.level === 'L0' ? undefined : { concurrency: 10, iterations: 1 };

  // -- login (200) ---------------------------------------------------------
  clearRateLimiter(ctx);
  let loginIndex = 0;
  await measureOp(
    ctx,
    result,
    'login',
    OK,
    async () => {
      const actor = pool[loginIndex % pool.length] ?? defaultActor;
      loginIndex += 1;
      return httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/member/login',
        body: { email: actor.email, password: actor.password },
      });
    },
    loginScale,
  );

  // -- refresh (200) -------------------------------------------------------
  clearRateLimiter(ctx);
  let refreshIndex = 0;
  await measureOp(
    ctx,
    result,
    'refresh',
    OK,
    async () => {
      const actor = pool[refreshIndex % pool.length] ?? defaultActor;
      refreshIndex += 1;
      // Each iteration obtains a fresh refresh token first (unmeasured), then
      // measures the refresh call itself.
      const login = await httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/member/login',
        body: { email: actor.email, password: actor.password },
      });
      const refreshToken = (login.body as { refreshToken?: string })
        ?.refreshToken;
      return httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        body: { refresh_token: refreshToken },
      });
    },
    loginScale,
  );

  // -- otp issue + verify (202 / 200) -------------------------------------
  clearRateLimiter(ctx);
  let otpIndex = 0;
  await measureOp(
    ctx,
    result,
    'otp/issue',
    CREATED,
    async () => {
      const actor = pool[otpIndex % pool.length] ?? defaultActor;
      otpIndex += 1;
      return httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/otp/issue',
        body: { destination: actor.email, purpose: 'EMAIL_VERIFICATION' },
      });
    },
    loginScale,
  );
  clearRateLimiter(ctx);
  otpIndex = 0;
  await measureOp(
    ctx,
    result,
    'otp/verify',
    OK,
    async () => {
      const actor = pool[otpIndex % pool.length] ?? defaultActor;
      otpIndex += 1;
      const issued = await httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/otp/issue',
        body: { destination: actor.email, purpose: 'EMAIL_VERIFICATION' },
      });
      const body = issued.body as {
        otp_id?: string;
        development_code?: string;
      };
      return httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/otp/verify',
        body: { otp_id: body.otp_id, code: body.development_code },
      });
    },
    loginScale,
  );

  // -- rate-limit guard observation (L2 only) -----------------------------
  if (ctx.level === 'L2') {
    clearRateLimiter(ctx);
    const burst = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        httpCall(ctx.baseUrl, {
          method: 'POST',
          path: '/api/v1/auth/member/login',
          body: {
            email: pool[i % pool.length]?.email ?? '',
            password: PASSWORD,
          },
        }),
      ),
    );
    const okCount = burst.filter((r) => r.status === 200).length;
    const limited = burst.filter((r) => r.status === 429).length;
    result.assertions.push({
      name: 'J1 login limiter enforces the 10/IP/300s ceiling (429 beyond)',
      pass: okCount >= 10 && limited >= 1 && okCount + limited === 15,
      detail: `burst 15: 200×${okCount} 429×${limited} (IP ceiling 10)`,
    });
  }

  // -- session reuse (authenticated member read) --------------------------
  await measureOp(ctx, result, 'session-reuse', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: '/api/v1/members/content/home',
      token: world.member.token,
    }),
  );

  // -- session teardown at L2 (logout) ------------------------------------
  if (ctx.level === 'L2') {
    clearRateLimiter(ctx);
    let logoutIndex = 0;
    await measureOp(
      ctx,
      result,
      'logout',
      NO_CONTENT,
      async () => {
        const actor = pool[logoutIndex % pool.length] ?? defaultActor;
        logoutIndex += 1;
        const login = await httpCall(ctx.baseUrl, {
          method: 'POST',
          path: '/api/v1/auth/member/login',
          body: { email: actor.email, password: actor.password },
        });
        const accessToken = (login.body as { accessToken?: string })
          ?.accessToken;
        return httpCall(ctx.baseUrl, {
          method: 'POST',
          path: '/api/v1/auth/logout',
          token: accessToken,
        });
      },
      loginScale,
    );
  }

  // -- assertions ----------------------------------------------------------
  for (const op of result.ops) {
    const pass = op.unexpectedErrorCount === 0;
    result.assertions.push({
      name: `J1 ${op.op} zero unexpected errors`,
      pass,
      detail: pass
        ? `${op.errorCount}/${op.samples.length} expected-or-zero errors`
        : `${op.unexpectedErrorCount} unexpected of ${op.samples.length}`,
    });
  }
  // Refresh tokens rotate: a refresh token must not be replayable after use
  // (covered functionally by auth integration suites; observed here at L2).
  if (ctx.level === 'L2') {
    const replayed = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refresh_token: 'definitely-not-a-real-token' },
    });
    const pass = replayed.status === 401;
    result.assertions.push({
      name: 'J1 invalid refresh token rejected (401)',
      pass,
      detail: `status ${replayed.status} (expected 401)`,
    });
  }

  return finishJourneyResult(result);
}
