import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canPerformSensitiveAdminWrite } from './pwa-policy.js';

describe('Admin PWA safety policy', () => {
  it('allows a sensitive write only in the full online desktop web flow', () => {
    expect(
      canPerformSensitiveAdminWrite({
        online: true,
        desktop: true,
        standalone: false,
      }),
    ).toBe(true);
    expect(
      canPerformSensitiveAdminWrite({
        online: false,
        desktop: true,
        standalone: false,
      }),
    ).toBe(false);
    expect(
      canPerformSensitiveAdminWrite({
        online: true,
        desktop: false,
        standalone: false,
      }),
    ).toBe(false);
    expect(
      canPerformSensitiveAdminWrite({
        online: true,
        desktop: true,
        standalone: true,
      }),
    ).toBe(false);
  });

  it('has no service-worker request interception or replay handler', () => {
    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    const executable = source.replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(executable).not.toMatch(/addEventListener\(['"]fetch/gu);
    expect(executable).not.toMatch(/addEventListener\(['"].*sync/gu);
    expect(executable).not.toMatch(/caches\.|indexedDB|queue/gu);
  });
});
