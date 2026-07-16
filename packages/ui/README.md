# @ipoint/ui

Shared, typed React component foundation for iPoint Member, Merchant, and Admin
applications. Components use the CSS variables from `@ipoint/design-tokens` and
ship keyboard, focus-visible, disabled, loading, error, and responsive states.

Import `@ipoint/design-tokens/base.css` once in the consuming application entry
point, then import components from `@ipoint/ui`.

The package provides primitives, forms, feedback, overlays, data display,
navigation, page structure, and responsive product shells. Product-specific
business behavior must remain in the application or domain modules.
