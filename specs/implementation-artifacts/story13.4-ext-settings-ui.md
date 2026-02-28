# Story 13.4: Dashboard — Ext Settings UI (Space Quota)

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: done
**Depends on**: Story 13.1 (Ext API), Story 13.2 (seed data), Story 13.3 (settings page route)

## User Story

As a superuser,
I want an "App Settings" section on the Settings page where I can update space quota limits,
so that I can adjust quotas without modifying code or restarting the service.

## Acceptance Criteria

- AC1: "App Settings" section appears on the `/settings` page below the PB settings sections.
- AC2: Space Quota card loads current values from `GET /api/ext/settings/space` on page mount.
- AC3: Form fields: `maxSizeMB`, `maxPerUser`, `maxUploadFiles`, `shareMaxMinutes`, `shareDefaultMinutes`, `uploadAllowExts[]`, `uploadDenyExts[]`.
- AC4: Save calls `PATCH /api/ext/settings/space` with `{ quota: { ...formValues } }` and shows success toast.
- AC5: Client-side validation: all fields required, positive integers; `maxUploadFiles` in `[1,200]`; `shareDefaultMinutes` ≤ `shareMaxMinutes`.
- AC6: API errors (`400`, `422`) are shown as specific error messages, not generic toasts.
- AC7: Whitelist precedence: when `uploadAllowExts` is non-empty, denylist is ignored.

## Tasks / Subtasks

- [x] Task 1: Extend the settings page from Story 13.3 (AC1)
  - [x] 1.1 "App Settings" section in settings.tsx below PB sections
  - [x] 1.2 `<FilesQuotaCard />` rendered inline in same file

- [x] Task 2: Load Ext settings on mount (AC2)
  - [x] 2.1 On mount, call `pb.send('/api/ext/settings/space')`
  - [x] 2.2 Extract `quota` group from response
  - [x] 2.3 On load error, toast shown

- [x] Task 3: Space Quota form (AC3, AC5)
  - [x] 3.1 Five number inputs with correct labels (`maxUploadFiles` included)
  - [x] 3.2 Client-side validation: all required ≥1, `maxUploadFiles` ≤ 200, shareDefaultMinutes ≤ shareMaxMinutes
  - [x] 3.3 Controlled state (no react-hook-form — not in project deps)

- [x] Task 4: Save handler (AC4, AC6)
  - [x] 4.1 PATCH /api/ext/settings/space
  - [x] 4.2 Success toast
  - [x] 4.3 400 error shown as specific message
  - [x] 4.4 Save button disabled while in-flight

- [x] Task 5: Upload extension policy fields (AC3, AC7)
  - [x] 5.1 Add `uploadAllowExts` input with examples (`yaml`, `yml`, `json`, `python`)
  - [x] 5.2 Add `uploadDenyExts` input with examples (`exe`, `dll`)
  - [x] 5.3 Disable/ignore denylist input when allowlist is non-empty

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
    <CardHeader><CardTitle>Space Quota</CardTitle></CardHeader>
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
- Space quota fields: [backend/internal/routes/space.go](backend/internal/routes/space.go)
- Form pattern: search for `react-hook-form` usage in existing dashboard components

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented in same file as Story 13.3 settings.tsx (co-located for simplicity)
- `react-hook-form` + `zod` not installed; used useState + manual validation
- Added `uploadAllowExts` and `uploadDenyExts` in Space Quota UI
- Added `maxUploadFiles` in Space Quota UI (default 50, range 1–200)
- Backend enforces `maxUploadFiles` for file create requests via `X-Space-Batch-Size` header
- Updated endpoint usage from `/api/ext/settings/files` to `/api/ext/settings/space`
- Enforced whitelist precedence behavior in UI hints and disable state

### File List

- `dashboard/src/routes/_app/_auth/_superuser/settings.tsx` (modified)
