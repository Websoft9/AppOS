---
name: AppOS
status: final
updated: 2026-07-11
sources:
  - ../../prd.md
  - ../../architecture.md
  - ../../coding-decisions-ui.md
  - ../../../web/src/index.css
  - ../../../web/src/components/resources/ResourceHub.tsx
  - ../../../web/src/locales/en/resources.json
colors:
  brand-50: '#EEF7FF'
  brand-100: '#D8EDFF'
  brand-200: '#B8DDFF'
  brand-300: '#89C7FF'
  brand-400: '#55ACFB'
  brand-500: '#248DE8'
  brand-600: '#146FC2'
  brand-700: '#11589A'
  brand-800: '#114B80'
  brand-900: '#143F69'
  ink-950: '#15212B'
  ink-900: '#233240'
  ink-700: '#516375'
  ink-600: '#647789'
  ink-500: '#8394A4'
  line: '#D8E1E8'
  panel: '#FFFFFF'
  page: '#F4F7FA'
  surface-page: '#FFFFFF'
  surface-page-dark: '#0A0A0A'
  text-primary: '#0A0A0A'
  text-primary-dark: '#FAFAFA'
  text-secondary: '#71717A'
  text-secondary-dark: '#A1A1AA'
  border-subtle: '#E4E4E7'
  border-subtle-dark: '#27272A'
  action-primary: '{colors.brand-600}'
  action-primary-foreground: '#FFFFFF'
  action-primary-dark: '{colors.brand-400}'
  action-primary-foreground-dark: '#08131F'
typography:
  body:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 14px
    lineHeight: '1.5'
    fontWeight: '400'
  body-sm:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 12px
    lineHeight: '1.5'
    fontWeight: '400'
  label:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 12px
    lineHeight: '1.3'
    fontWeight: '500'
  title-page:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 30px
    lineHeight: '1.2'
    fontWeight: '700'
  title-section:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 18px
    lineHeight: '1.3'
    fontWeight: '600'
  title-card:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 14px
    lineHeight: '1.3'
    fontWeight: '500'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  card: 12px
  section: 16px
  dialog: 16px
  pill: 999px
spacing:
  scale-base: 4px
  stack-xs: 8px
  stack-sm: 12px
  stack-md: 16px
  stack-lg: 24px
  stack-xl: 32px
  page-padding-desktop: 24px
  page-padding-mobile: 16px
components:
  app-shell-header:
    background: '{colors.surface-page}'
    border: '{colors.border-subtle}'
  app-shell-sidebar:
    background: '{colors.surface-page}'
    border: '{colors.border-subtle}'
  app-shell-bottom-bar:
    background: '{colors.surface-page}'
    border: '{colors.border-subtle}'
  button-primary:
    background: '{colors.action-primary}'
    foreground: '{colors.action-primary-foreground}'
    radius: '{rounded.lg}'
  button-secondary:
    background: '{colors.surface-page}'
    foreground: '{colors.text-primary}'
    border: '{colors.border-subtle}'
    radius: '{rounded.lg}'
  section-surface:
    background: '{colors.panel}'
    background-dark: '{colors.surface-page-dark}'
    radius: '{rounded.section}'
    border: 'none'
  inventory-surface:
    background: '{colors.panel}'
    border: '{colors.border-subtle}'
    radius: '{rounded.section}'
  selected-item-surface:
    background: '{colors.panel}'
    border: '{colors.border-subtle}'
    radius: '{rounded.section}'
  resource-entry-card:
    background: '{colors.panel}'
    border: '{colors.border-subtle}'
    radius: '{rounded.card}'
  resource-entry-card-hover:
    border: '{colors.brand-300}'
    shadow: 'md'
  resource-icon-chip:
    background: '#F4F4F5'
    foreground: '{colors.ink-700}'
    background-dark: '#27272A'
    foreground-dark: '#D4D4D8'
    radius: '{rounded.md}'
  metadata-pill:
    background: '#F4F4F5'
    foreground: '{colors.text-secondary}'
    radius: '{rounded.pill}'
  list-settings-trigger:
    background: 'transparent'
    foreground: '{colors.text-secondary}'
    radius: '{rounded.md}'
  overlay-dialog:
    background: '{colors.panel}'
    radius: '{rounded.dialog}'
  form-section-advanced:
    background: '#FAFAFA'
    background-dark: '#18181B'
    border: '{colors.border-subtle}'
    radius: '{rounded.card}'
  key-value-grid:
    foreground-label: '{colors.text-secondary}'
    foreground-value: '{colors.text-primary}'
---

## Brand & Style

AppOS is an operator-facing platform, not a consumer productivity tool and not a raw infrastructure console. The product posture is calm, competent, and low-noise. It should feel easier than a typical admin surface without becoming playful, abstract, or marketing-like.

The current visual identity follows the chosen Atlas Calm direction: neutral-first surfaces, controlled blue emphasis, strong grouping, and restrained metadata. Cloudflare contributes compositional calm; AWS Console contributes infrastructural seriousness. AppOS keeps both, but avoids enterprise sprawl.

AppOS inherits shadcn/ui and Tailwind defaults wherever the brand does not need a stronger rule. This DESIGN.md specifies the AppOS layer on top: brand blues, page hierarchy, section surfaces, resource-entry card treatment, and the restraint rules that keep the product from drifting into CRUD clutter.

## Colors

AppOS uses two color families with different jobs.

- **Brand blue** is the action and emphasis layer. It is used for primary actions, selected emphasis, directional affordances, and focus-adjacent cues. `brand-600` is the primary action color; `brand-400` is the dark-mode counterpart.
- **Neutral ink and surfaces** carry the majority of the UI. Layout, hierarchy, and borders should explain structure before color does.

Light and dark themes inherit the existing shadcn variable system in `web/src/index.css`. AppOS does not replace that semantic model. Instead, this contract names the additional brand-layer tokens that future stories and components should reference.

Color discipline:

- Do not assign each resource family its own accent color.
- Do not turn list and detail pages into dark-bordered card stacks by default.
- Use blue for action and meaning, not for saturation.
- Contrast for text, focus, and actionable states must remain WCAG AA across both modes.

## Typography

AppOS uses a sober sans-serif system stack. There is no brand display typeface and no decorative typographic moment. Readability and scan speed win over personality.

- `title-page` is the standard list/index page heading contract and matches the existing engineering convention: `text-2xl font-bold tracking-tight`.
- `title-section` is used for grouped sections, drawers, tabs, and self-contained tool surfaces.
- `title-card` is used for resource-entry cards and similar compact navigational objects.
- `body` and `body-sm` carry descriptions, helper copy, metadata, and table-adjacent support text.

The type system should communicate hierarchy with weight and spacing first. Avoid large type ramps, decorative italic, and marketing-style hero treatment.

## Layout & Spacing

AppOS layout is compact but breathable. The product should never read as either sparse marketing UI or dense enterprise console.

- Page sections are separated with `stack-lg` or `stack-xl` spacing.
- Resource and list surfaces use `stack-sm` and `stack-md` internally.
- Desktop page padding defaults to `page-padding-desktop`; mobile reduces to `page-padding-mobile`.
- Tailwind's default 4px spacing scale is inherited. Custom spacing tokens are composition guidance, not a parallel spacing system.

Structural priorities:

- Use spacing to express grouping before adding borders.
- Reduce columns before reducing meaning on smaller screens.
- When a screen feels like a stack of equal cards, reduce chrome before reducing information.

## Elevation & Depth

AppOS uses shallow depth. Elevation is a secondary cue for interactivity, not a hierarchy system.

- Default surfaces are flat or nearly flat.
- Hover and focus may add a light lift on navigational cards.
- Dialogs and drawers may use standard shadcn shadow depth.
- Avoid heavy inset treatments, glossy gradients, and dramatic shadow stacks.

## Shapes

AppOS corners are soft but not rounded enough to feel consumer-social or mobile-first. Cards and dialogs should feel precise.

- Inputs and chips use `rounded.md`.
- Standard cards use `rounded.card`.
- Section wrappers and dialogs use `rounded.section` or `rounded.dialog`.
- Pills and count chips use `rounded.pill`.

Do not mix many corner systems on one surface.

## Components

The majority of AppOS components inherit shadcn defaults. The following components are load-bearing and should stay visually consistent across future work.

- **Primary button**: uses `{colors.action-primary}` in light mode and `{colors.action-primary-dark}` in dark mode. It should feel confident but not oversized.
- **Secondary button / refresh button**: neutral border, neutral background, low emphasis.
- **Section surface**: lightweight grouped wrapper for orientation or overview sections. Use it when the section boundary itself helps comprehension.
- **App shell header / sidebar / bottom bar**: neutral structural chrome. These areas organize the product; they should not compete visually with page content.
- **Inventory surface**: bordered container for dense selectable inventories such as Systemd, Crontab, and component lists.
- **Selected-item surface**: paired companion to the inventory surface. Same visual family, but allowed to feel slightly more focused through stronger title hierarchy.
- **Resource entry card**: canonical navigation card for resource families. Border remains subtle at rest; hover/focus increases emphasis, not saturation.
- **Resource icon chip**: muted icon container inside resource cards. On hover/focus it may tint toward the brand blue family.
- **Metadata pill**: low-noise counts and secondary labels. Never louder than the title.
- **List settings trigger**: ghost icon button with low default emphasis. It should look like an optional tuning control, not a primary action.
- **Overlay dialog**: standard shadcn dialog shell with AppOS spacing and page-heading hierarchy.
- **Advanced form section**: collapsible bordered block inside dialogs. It should read as optional, not hidden or scary.
- **Key-value grid**: read-only metadata presentation where labels are muted, values are foreground, and spacing carries structure.

Inherited as-is unless a story says otherwise: `Button`, `Card`, `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Tabs`, `Table`, `Input`, `Badge`.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Let grouping, spacing, and labels carry meaning | Use multiple accent colors to teach taxonomy |
| Keep blue reserved for action, emphasis, and direction | Fill large surfaces with brand blue |
| Reuse shadcn defaults unless AppOS needs a stronger rule | Create a second parallel design system |
| Keep metadata visibly secondary to titles and actions | Let counts, badges, and hints compete with primary navigation |
| Make admin surfaces calm and trustworthy | Make them playful, gamified, or visually loud |
