# @ipoint/design-tokens

Official iPoint Product Design System V1.0 foundation. TypeScript consumers import
token groups from `@ipoint/design-tokens`; browser applications import
`@ipoint/design-tokens/base.css` once at their entry point.

The default theme is light. A future dark theme can opt in by setting
`data-theme="dark"` on a root element without changing component contracts.
Spacing follows an 8pt grid, radii use the approved 12-20px range, and motion is
automatically minimized when the operating system requests reduced motion.
