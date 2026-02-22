# Coding Decisions - UI

## Link Back

For global engineering conventions, see [coding-decisions.md](coding-decisions.md).

## UI{#ui}

Design System Foundation (shadcn/ui, Tailwind, Dark/Light theme)

### Dialog Size Tiers{#dialog-sizes}

Standardized dialog widths based on content type. Override via `className` on `<DialogContent>`.

| Tier | Tailwind Class | Width | Use Case |
|------|---------------|-------|----------|
| **sm** | `max-w-sm` | 384px | Confirmations, simple alerts |
| **default** | (shadcn default `sm:max-w-lg`) | 512px | Forms, simple CRUD dialogs |
| **md** | `max-w-2xl` | 672px | Multi-field forms, detail views |
| **lg** | `max-w-4xl` | 896px | Terminal/code output, wide tables, command runners |
| **xl** | `max-w-6xl` | 1152px | Complex editors, side-by-side layouts |
| **full** | `max-w-[90vw] max-h-[85vh]` | ~90% viewport | Log viewers, full-screen editors |

**Guidelines:**
- Always pair large dialogs with `max-h-[85vh] flex flex-col` for scroll containment
- Mobile fallback is handled by shadcn's `max-w-[calc(100%-2rem)]`
- Prefer the smallest tier that avoids horizontal scrolling or cramped content
