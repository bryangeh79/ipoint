# ADR-007: iPoint Design System Foundation

- Status: Accepted
- Date: 2026-07-16
- Scope: P0-S7

## Context

Member, Merchant, and Admin products require one accessible, international-ready
visual language before business screens are implemented. The approved Product
Design System V1.0 defines green `#20B366` as the primary brand color, gold as
the secondary accent, white surfaces, an 8pt spacing grid, 12-20px radii,
Inter/Noto Sans typography, outlined icons, mobile-first layouts, and minimal
motion.

## Decision

`@ipoint/design-tokens` is the single source for TypeScript tokens and CSS custom
properties. Light mode is the default; `[data-theme="dark"]` is an extension
point and does not imply a Phase 0 product theme switcher.

`@ipoint/ui` owns shared presentation and accessibility behavior. Components
use semantic HTML, visible focus, minimum touch targets, reduced-motion support,
keyboard navigation, and focus-managed dialogs. Product applications own
business state and orchestration.

All three web applications use the same responsive `AppShell`: persistent side
navigation on desktop and adapted bottom/drawer navigation on mobile. Phase 0
contains placeholder dashboards only.

Lucide React is the approved outlined-icon implementation for this foundation.

## Consequences

- UI consistency and accessibility fixes can be made once for all products.
- Future dark mode can extend tokens without changing component APIs.
- Product teams must not hard-code visual values already represented by tokens.
- Native application implementations may mirror these tokens but remain outside
  this web package.
- Components remain unopinionated about member, merchant, or admin business
  rules.
