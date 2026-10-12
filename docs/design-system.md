# Design system

Auram interfaces are dark, neutral and strictly geometric. The goal is the calm, precise feel of
professional creative software.

## Principles

1. **Grid first.** Layouts are built from a fixed sidebar (232 px), a 40 px top bar and
   rectangular content regions on a 4 px spacing scale. Cards align to CSS grids with a shared gap.
2. **Square geometry.** Buttons, inputs, selects, switches, cards, dialogs and tags have square
   corners (`--radius-none`). `--radius-xs` (2 px) exists for rare exceptions.
3. **Neutral palette.** Black, charcoal and greys. Hue is reserved for meaning: success, warning,
   danger, info, and the focus ring.
4. **Borders over shadows.** Surfaces are separated by one-pixel borders and small differences in
   surface tone. No glow, glassmorphism or decorative gradients.
5. **Quiet motion.** Transitions are short (80–140 ms) and functional. They are disabled when the
   OS requests reduced motion or the user enables _Reduce motion_.
6. **Accessible by default.** Every interactive element has a visible `:focus-visible` ring,
   native semantics (buttons, labels, `<dialog>`, `<select>`, `role="switch"`), and accessible names.

## Tokens

All values live in `packages/design-tokens/src/tokens.css`:

| Group    | Examples                                                                                      |
| -------- | --------------------------------------------------------------------------------------------- |
| Surfaces | `--color-bg`, `--color-surface-0` … `--color-surface-3`, `--color-overlay`                    |
| Borders  | `--color-border-subtle`, `--color-border`, `--color-border-strong`                            |
| Text     | `--color-text-primary`, `-secondary`, `-tertiary`, `-disabled`, `-inverse`                    |
| Actions  | `--color-primary` (near-white), `-hover`, `-active`                                           |
| Semantic | `--color-success`, `--color-warning`, `--color-danger`, `--color-info`                        |
| Focus    | `--color-focus`, `--focus-ring-width`, `--focus-ring-offset`                                  |
| Spacing  | `--space-1` (4 px) … `--space-16` (64 px)                                                     |
| Type     | `--font-sans`, `--font-mono`, `--text-xs` … `--text-2xl`, weights, leading                    |
| Controls | `--control-height-sm/md/lg`, `--control-padding-x`                                            |
| Layout   | `--topbar-height`, `--sidebar-width`, `--content-max-width`, `--grid-gap`, `--card-min-width` |
| Icons    | `--icon-sm` … `--icon-xl`                                                                     |
| Motion   | `--duration-fast`, `--duration-base`, `--easing-standard`                                     |

`packages/design-tokens/src/tokens.test.ts` fails the build if any component stylesheet uses a
literal colour or a border radius other than the radius tokens, and checks that the TypeScript
mirror (used for the native window background) matches the CSS.

## Components (`@auram/ui`)

`Button` (primary, secondary, ghost, danger; sm/md/lg; busy state), `IconButton` (requires a
label), `Field`, `TextInput`, `Select`, `Switch`, `Dialog`, `ToastViewport`, `SectionHeader`,
`Panel`, `StatusTag`, `ProgressBar`, `EmptyState`, `LoadingState`, `ErrorState`, `NavItem`.

Launcher-specific compositions (`AppCard`, `AppRow`, `ProjectCard`) live in
`apps/launcher/src/renderer/src/components`.

## Icons

[Lucide](https://lucide.dev) only, stroke width 1.5–1.75, sized with the icon tokens. No emoji.

## Brand

The Auram mark is the official logo supplied by the project owner. The interface uses a
tone-inverted variant generated from it (see `assets/brand/README.md`). Do not redraw or
restyle the mark.
