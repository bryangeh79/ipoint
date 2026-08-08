/**
 * OpenAPI Runtime Validation Script
 *
 * Compile this with `tsc` alongside the app, then run the compiled output.
 * This ensures decorator metadata (design:paramtypes) is present in the
 * generated OpenAPI document.
 *
 * Build:   pnpm --filter @ipoint/api build
 * Run:     node apps/api/dist/__scripts__/openapi-validate.js
 */

import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';

// ---- 1. Bootstrap ----
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  'postgresql://ignore:ignore@localhost:5432/ignore';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
process.env['AUTH_OTP_PEPPER'] =
  process.env['AUTH_OTP_PEPPER'] ?? 'openapi-validate-32-chars-pepper!!!!';
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';

async function main(): Promise<void> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  configureApplication(app, {
    enableShutdownHooks: false,
    scanSwaggerRoutes: false,
  });
  // Swagger only needs the compiled Nest container. Initializing the full
  // application would start workers and schedulers, making this read-only
  // validation depend on external runtime lifecycle state.

  // ---- 2. Generate OpenAPI document ----
  const config = new DocumentBuilder()
    .setTitle('iPoint API')
    .setVersion('0.0.0')
    .build();

  let document: Record<string, unknown>;
  try {
    document = SwaggerModule.createDocument(app, config) as unknown as Record<
      string,
      unknown
    >;
  } catch (err: unknown) {
    console.error('FATAL: SwaggerModule.createDocument threw:', err);
    process.exit(1);
  }

  const paths = document.paths as Record<string, Record<string, unknown>>;
  const totalPaths = Object.keys(paths).length;
  const authPaths = Object.keys(paths).filter((p) =>
    p.startsWith('/api/v1/auth'),
  );
  const components = document.components as Record<string, unknown> | undefined;
  const schemas = (components?.schemas ?? {}) as Record<string, unknown>;
  const schemaCount = Object.keys(schemas).length;
  const errors: string[] = [];
  const seenOpIds = new Map<string, string>();

  console.log(`\nTotal OpenAPI paths: ${totalPaths}`);
  console.log(`Auth paths: ${authPaths.length}`);
  console.log(`Auth operations: ${authPaths.length}`); // all are POST
  console.log(`Schemas in components: ${schemaCount}\n`);

  // 23 expected auth endpoints
  const expected: string[] = [
    '/api/v1/auth/login',
    '/api/v1/auth/member/login',
    '/api/v1/auth/refresh',
    '/api/v1/auth/member/refresh',
    '/api/v1/auth/logout',
    '/api/v1/auth/member/logout',
    '/api/v1/auth/registration/initiate',
    '/api/v1/auth/member/register',
    '/api/v1/auth/registration/verify',
    '/api/v1/auth/member/register/verify',
    '/api/v1/auth/registration/complete',
    '/api/v1/auth/member/register/complete',
    '/api/v1/auth/registration/resend',
    '/api/v1/auth/member/register/resend-otp',
    '/api/v1/auth/password-reset/initiate',
    '/api/v1/auth/member/password-reset/request',
    '/api/v1/auth/password-reset/verify',
    '/api/v1/auth/member/password-reset/verify',
    '/api/v1/auth/password-reset/complete',
    '/api/v1/auth/member/password-reset/complete',
    '/api/v1/auth/otp/issue',
    '/api/v1/auth/otp/verify',
    '/api/v1/auth/password/reset',
  ];

  const protectedEndpoints = new Set([
    '/api/v1/auth/logout',
    '/api/v1/auth/member/logout',
  ]);

  for (const ep of expected) {
    if (!paths[ep]) {
      errors.push(`MISSING: ${ep}`);
      continue;
    }
    const post = paths[ep]['post'] as Record<string, unknown> | undefined;
    if (!post) {
      errors.push(`MISSING post method: ${ep}`);
      continue;
    }

    if (!post.summary || (post.summary as string).length < 5)
      errors.push(`${ep}: missing/too-short summary`);
    if (!post.description) errors.push(`${ep}: missing description`);

    const responses = post.responses as Record<string, unknown> | undefined;
    if (!responses || Object.keys(responses).length === 0)
      errors.push(`${ep}: no responses`);

    const opId = post.operationId as string | undefined;
    if (opId) {
      if (seenOpIds.has(opId))
        errors.push(
          `DUPLICATE operationId "${opId}" in ${ep} (also ${seenOpIds.get(opId)})`,
        );
      else seenOpIds.set(opId, ep);
    }

    if (protectedEndpoints.has(ep)) {
      if (!post.security) errors.push(`${ep}: missing bearer security`);
    } else {
      if (post.security) errors.push(`${ep}: has unexpected security`);
    }
  }

  // Check $ref integrity
  const serialized = JSON.stringify(document);
  const refRegex = /"\$ref":\s*"#\/components\/schemas\/([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(serialized)) !== null) {
    const schemaName = match[1];
    if (schemaName && !schemas[schemaName])
      errors.push(`Broken $ref: #/components/schemas/${schemaName}`);
  }

  // Report
  console.log('=== OpenAPI Runtime Validation ===');
  console.log(`Total paths:           ${totalPaths}`);
  console.log(`Auth paths:            ${authPaths.length}`);
  console.log(`Auth operations:       ${authPaths.length}`);
  console.log(`Schemas:               ${schemaCount}`);
  console.log(
    `Missing schemas:       ${errors.filter((e) => e.startsWith('Broken')).length}`,
  );
  console.log(
    `Duplicate operationId: ${
      [...seenOpIds.entries()].filter(
        ([, v]) =>
          expected.filter((e) => {
            const p = paths[e]?.['post'] as Record<string, unknown> | undefined;
            return (
              p?.operationId ===
              [...seenOpIds.entries()].find(([k2]) => k2 === v)?.[0]
            );
          }).length > 1,
      ).length
    }`,
  );

  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} validation error(s):`);
    for (const e of errors) console.log(`  ${e}`);
    process.exit(1);
  }

  console.log('\n✅ All runtime OpenAPI validations passed.');
  console.log(`Output generated at: ${new Date().toISOString()}`);
  await app.close();
}

await main();
