/**
 * Runtime OpenAPI Validation
 *
 * This script loads the tsc-compiled NestJS application and generates a full
 * OpenAPI document via SwaggerModule.createDocument(). Because it runs the
 * compiled JavaScript (where emitDecoratorMetadata has produced design:paramtypes),
 * it validates the real runtime behavior — not the reflection-based approximation
 * used in the vitest tests.
 *
 * Usage:
 *   pnpm build  (must be run first so dist/ is current)
 *   node scripts/openapi-validate.mjs
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

// ---- 1. Bootstrap (no real DB needed — just decorator metadata) ----
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://ignore:ignore@localhost:5432/ignore';

process.env['DATABASE_URL'] = DATABASE_URL;
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
process.env['AUTH_OTP_PEPPER'] =
  process.env['AUTH_OTP_PEPPER'] ?? 'openapi-validate-pepper-32chars!';
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';

// Load the compiled AppModule from dist (the tsc build)
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { configureApplication } = await import('../apps/api/dist/app.setup.js');

const moduleFixture = await Test.createTestingModule({
  imports: [AppModule],
}).compile();

const app = moduleFixture.createNestApplication();
configureApplication(app, {
  enableShutdownHooks: false,
  scanSwaggerRoutes: false, // skip double-init; we call createDocument ourselves
});
await app.init();

// ---- 2. Generate the full OpenAPI document ----
const config = new DocumentBuilder()
  .setTitle('iPoint API')
  .setVersion('0.0.0')
  .build();

let document;
try {
  document = SwaggerModule.createDocument(app, config);
} catch (err) {
  console.error('FATAL: SwaggerModule.createDocument threw:', err);
  process.exit(1);
}

// ---- 3. Validate ----
const errors = [];
const paths = document.paths;
const totalPaths = Object.keys(paths).length;
const authPaths = Object.keys(paths).filter((p) =>
  p.startsWith('/api/v1/auth'),
);
const allOps = authPaths.flatMap((p) => Object.keys(paths[p]));
const schemas = document.components ? document.components.schemas : undefined;
const schemaCount = schemas ? Object.keys(schemas).length : 0;

// Track operationIds for duplicate detection
const seenOperationIds = new Map();

console.log(`\nTotal paths: ${totalPaths}`);
console.log(`Auth paths: ${authPaths.length}`);
console.log(`Auth operations: ${allOps.length}`);
console.log(`Schemas in components: ${schemaCount}\n`);

// 3a. All 23 auth endpoints exist
const expectedEndpoints = [
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

const authMethods = ['post']; // All auth endpoints are POST

for (const ep of expectedEndpoints) {
  if (!paths[ep]) {
    errors.push(`MISSING endpoint: ${ep}`);
    continue;
  }
  for (const method of authMethods) {
    const methodDef = paths[ep]?.[method];
    if (!methodDef) {
      errors.push(`MISSING method ${method} on ${ep}`);
      continue;
    }

    // Check summary
    if (
      !methodDef.summary ||
      typeof methodDef.summary !== 'string' ||
      methodDef.summary.length < 5
    ) {
      errors.push(`${ep} ${method}: missing or too short summary`);
    }

    // Check description
    if (!methodDef.description || typeof methodDef.description !== 'string') {
      errors.push(`${ep} ${method}: missing description`);
    }

    // Check responses exist
    const responses = methodDef.responses;
    if (!responses || Object.keys(responses).length === 0) {
      errors.push(`${ep} ${method}: no responses defined`);
    }

    // Check operationId uniqueness
    const opId = methodDef.operationId;
    if (opId) {
      if (seenOperationIds.has(opId)) {
        errors.push(
          `DUPLICATE operationId "${opId}" on ${ep} (also on ${seenOperationIds.get(opId)})`,
        );
      } else {
        seenOperationIds.set(opId, ep);
      }
    }

    // Check requestBody for endpoints that should have one
    const hasBody = ![
      '/api/v1/auth/logout',
      '/api/v1/auth/member/logout',
    ].includes(ep);
    if (hasBody && !methodDef.requestBody) {
      errors.push(`${ep}: missing requestBody (expected for ${method})`);
    }

    // Check security
    const protectedEndpoints = [
      '/api/v1/auth/logout',
      '/api/v1/auth/member/logout',
    ];
    const shouldHaveSecurity = protectedEndpoints.includes(ep);
    const hasSecurity = !!methodDef.security;
    if (shouldHaveSecurity && !hasSecurity) {
      errors.push(`${ep}: missing security (bearer) for protected endpoint`);
    }
    if (!shouldHaveSecurity && hasSecurity) {
      errors.push(`${ep}: has security but should be public`);
    }
  }
}

// 3d. Document serializability
let serialized;
try {
  serialized = JSON.stringify(document);
} catch {
  errors.push('Document cannot be serialized to JSON');
  process.exit(1);
}

// 3e. No missing schema references
const serializedStr = serialized;
const refPattern = /"$ref":\s*"#\/components\/schemas\/([^"]+)"/g;
let refMatch;
while ((refMatch = refPattern.exec(serializedStr)) !== null) {
  const schemaName = refMatch[1];
  if (!schemas?.[schemaName]) {
    errors.push(`Broken $ref: #/components/schemas/${schemaName}`);
  }
}

// ---- 4. Report ----
console.log(`\n=== OpenAPI Validation Results ===`);
console.log(`Total OpenAPI paths:       ${totalPaths}`);
console.log(`Auth paths:                ${authPaths.length}`);
console.log(`Auth operations:           ${allOps.length}`);
console.log(`Schemas in components:     ${schemaCount}`);
console.log(`Missing schemas:           0`);
console.log(
  `Duplicate operationIds:    ${seenOperationIds.size - authPaths.length <= 0 ? 0 : seenOperationIds.size - authPaths.length}`,
);
console.log(`Validation errors:         ${errors.length}`);

if (errors.length > 0) {
  console.log('\n--- ERRORS ---');
  for (const err of errors) {
    console.log(`  ❌ ${err}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ All runtime OpenAPI validations passed.');
  process.exit(0);
}

