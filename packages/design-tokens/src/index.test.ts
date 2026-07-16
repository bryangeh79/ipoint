import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  breakpoints,
  colors,
  designSystemStatus,
  radii,
  spacing,
  typography,
} from './index.js';

describe('official design tokens', () => {
  it('exports the approved brand and foundation tokens', () => {
    expect(colors.brand.primary).toBe('#20B366');
    expect(colors.brand.secondary).toBe('#C89B2C');
    expect(typography.fontFamily.latin).toContain('Inter');
    expect(typography.fontFamily.simplifiedChinese).toContain('Noto Sans SC');
    expect(spacing[1]).toBe('8px');
    expect(Object.values(radii)).toEqual(
      expect.arrayContaining(['12px', '16px', '20px']),
    );
    expect(breakpoints.md).toBe('768px');
    expect(designSystemStatus).toBe('official-v1-foundation');
  });

  it('publishes matching CSS variables and a dark-theme extension point', () => {
    const css = readFileSync(
      fileURLToPath(new URL('./base.css', import.meta.url)),
      'utf8',
    );
    expect(css).toContain('--ip-color-primary: #20b366');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
