# Story 13.4: Dashboard — Ext Settings UI (Files Quota)

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: ready-for-dev
**Depends on**: Story 13.1 (Ext API), Story 13.2 (seed data), Story 13.3 (settings page route)

## User Story

As a superuser,
I want an "App Settings" section on the Settings page where I can update file quota limits,
so that I can adjust quotas without modifying code or restarting the service.

## Acceptance Criteria

- AC1: "App Settings" section appears on the `/settings` page below the PB settings sections.
- AC2: Files Quota card loads current values from `GET /api/ext/settings/files` on page mount.
- AC3: Form fields: `maxSizeMB` (number), `maxPerUser` (number), `shareMaxMinutes` (number), `shareDefaultMinutes` (number).
- AC4: Save calls `PATCH /api/ext/settings/files` with `{ quota: { ...formValues } }` and shows success toast.
- AC5: Client-side validation: all fields required, positive integers; `shareDefaultMinutes` ≤ `shareMaxMinutes`.
- AC6: API errors (`400`, `422`) are shown as specific error messages, not generic toasts.

## Tasks / Subtasks

- [ ] Task 1: Extend the settings page from Story 13.3 (AC1)
  - [ ] 1.1 In `dashboard/src/routes/_app/_auth/_superuser/settings.tsx`, add a second `<section>` or `<div>` below PB sections titled "App Settings"
  - [ ] 1.2 Inside, render `<FilesQuotaCard />` component (defined in same file or extracted)

- [ ] Task 2: Load Ext settings on mount (AC2)
  - [ ] 2.1 On page mount (alongside the existing PB settings fetch), call `pb.send('/api/ext/settings/files')`
  - [ ] 2.2 Extract `quota` group from response; populate form state
  - [ ] 2.3 On load error, show toast and render the card with empty/default values

- [ ] Task 3: Files Quota form (AC3, AC5)
  - [ ] 3.1 Four number inputs in a 2×2 grid:
    - `maxSizeMB` — label "Max File Size (MB)", min 1
    - `maxPerUser` — label "Max Files per User", min 1
    - `shareMaxMinutes` — label "Share Max Duration (min)", min 1
    - `shareDefaultMinutes` — label "Share Default Duration (min)", min 1
  - [ ] 3.2 Validation (client-side before submit):
    - All fields: required, integer, ≥ 1
    - `shareDefaultMinutes` ≤ `shareMaxMinutes` — show inline field error if violated
  - [ ] 3.3 Use `react-hook-form` + `zod` schema consistent with the rest of the codebase

- [ ] Task 4: Save handler (AC4, AC6)
  - [ ] 4.1 On Save: `pb.send('/api/ext/settings/files', { method: 'PATCH', body: { quota: { maxSizeMB, maxPerUser, shareMaxMinutes, shareDefaultMinutes } } })`
  - [ ] 4.2 On success: show "Files quota saved" toast; update local state with returned values
  - [ ] 4.3 On `400`: show "Unknown setting key" error message
  - [ ] 4.4 On `422`: extract field-level errors from response body and show inline under each field
  - [ ] 4.5 Disable Save button while request is in-flight; re-enable on completion

## Dev Notes

### Zod schema
```ts
const filesQuotaSchema = z.object({
  maxSizeMB:            z.number().int().min(1),
  maxPerUser:           z.number().int().min(1),
  shareMaxMinutes:      z.number().int().min(1),
  shareDefaultMinutes:  z.number().int().min(1),
}).refine(
  (d) => d.shareDefaultMinutes <= d.shareMaxMinutes,
  { message: 'Default duration cannot exceed max duration', path: ['shareDefaultMinutes'] },
)
```

### UI placement
```tsx
<section>
  <h2 className="text-lg font-semibold mb-4">App Settings</h2>
  <Card>
    <CardHeader><CardTitle>Files Quota</CardTitle></CardHeader>
    <CardContent>
      {/* 2-col grid of number inputs */}
      <Button type="submit" disabled={isSaving}>
        {isSaving ? <Loader2 className="animate-spin" /> : 'Save'}
      </Button>
    </CardContent>
  </Card>
</section>
```

### References
- PB settings page (Story 13.3): [specs/implementation-artifacts/story13.3-pb-settings-ui.md](specs/implementation-artifacts/story13.3-pb-settings-ui.md)
- Ext API contract: [specs/implementation-artifacts/epic13-settings.md](specs/implementation-artifacts/epic13-settings.md) §Ext API
- Files quota fields: [backend/internal/routes/files.go](backend/internal/routes/files.go) (current hardcoded values)
- Form pattern: search for `react-hook-form` usage in existing dashboard components

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-5

### Debug Log References

### Completion Notes List

### File List
