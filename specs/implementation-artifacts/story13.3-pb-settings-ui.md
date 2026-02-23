# Story 13.3: Dashboard — PB Settings UI

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: ready-for-dev
**Depends on**: Story 13.1 (superuser route pattern established)

## User Story

As a superuser,
I want a Settings page in the Dashboard where I can view and update Application, SMTP, S3, and Logs settings,
so that I can configure the system without leaving the AppOS UI or using the PocketBase Admin panel.

## Acceptance Criteria

- AC1: `/settings` route exists, accessible only to superusers; regular users are redirected to `/`.
- AC2: Page loads current settings from `GET /api/settings` on mount.
- AC3: Application section displays and saves `meta.appName` and `meta.appURL` only.
- AC4: SMTP section displays all SMTP fields with a "Send Test Email" button that calls `POST /api/settings/test/email`.
- AC5: S3 section displays all S3 fields with a "Test Connection" button that calls `POST /api/settings/test/s3`.
- AC6: Logs section displays `maxDays`, `minLevel`, `logIP`, `logAuthId`.
- AC7: Each section has its own Save button; saving merges only that section's fields into the full settings object (all other PB fields preserved).
- AC8: A "PocketBase Admin →" link at the top opens `/_/` in a new tab.
- AC9: Backups / Crons / RateLimits / Batch / TrustedProxy sections are NOT rendered.

## Tasks / Subtasks

- [ ] Task 1: Route file (AC1)
  - [ ] 1.1 Create `dashboard/src/routes/_app/_auth/_superuser/settings.tsx`
  - [ ] 1.2 Export `Route = createFileRoute('/_app/_auth/_superuser/settings')({...})`

- [ ] Task 2: Data loading (AC2)
  - [ ] 2.1 On mount, call `pb.send('/api/settings', { method: 'GET' })` and store result in component state
  - [ ] 2.2 Show loading skeleton while fetching; show error toast on failure

- [ ] Task 3: Application section (AC3, AC7)
  - [ ] 3.1 Two fields: `appName` (text), `appURL` (text/url)
  - [ ] 3.2 Save: `pb.send('/api/settings', { method: 'PATCH', body: { meta: { ...currentMeta, appName, appURL } } })`
  - [ ] 3.3 Merge pattern: read full current `meta` object → spread → override only `appName`/`appURL`

- [ ] Task 4: SMTP section (AC4, AC7)
  - [ ] 4.1 Fields: `enabled` (Switch), `host`, `port` (number), `username`, `password` (password type), `authMethod` (select: `""/"PLAIN"/"LOGIN"/"CRAM-MD5"`), `tls` (Switch), `localName`
  - [ ] 4.2 Save: `pb.send('/api/settings', { method: 'PATCH', body: { smtp: { ...formValues } } })`
  - [ ] 4.3 "Send Test Email" button: prompt for recipient email → `pb.send('/api/settings/test/email', { method: 'POST', body: { template: { subject: 'Test', actionUrl: '', actionName: '' }, to: [ { address: email, name: '' } ] } })` → show success/error toast

- [ ] Task 5: S3 section (AC5, AC7)
  - [ ] 5.1 Fields: `enabled` (Switch), `bucket`, `region`, `endpoint`, `accessKey`, `secret` (password type), `forcePathStyle` (Switch)
  - [ ] 5.2 Save: `pb.send('/api/settings', { method: 'PATCH', body: { s3: { ...formValues } } })`
  - [ ] 5.3 "Test Connection" button: `pb.send('/api/settings/test/s3', { method: 'POST' })` → show success/error toast

- [ ] Task 6: Logs section (AC6, AC7)
  - [ ] 6.1 Fields: `maxDays` (number, min 1), `minLevel` (select: `0=DEBUG / 5=INFO / 8=WARN / 9=ERROR`), `logIP` (Switch), `logAuthId` (Switch)
  - [ ] 6.2 Save: `pb.send('/api/settings', { method: 'PATCH', body: { logs: { ...formValues } } })`

- [ ] Task 7: Page layout and header link (AC8, AC9)
  - [ ] 7.1 Page title: "Settings"
  - [ ] 7.2 Right side of header row: `<a href="/_/" target="_blank" rel="noreferrer">PocketBase Admin →</a>` as a Button variant="outline"
  - [ ] 7.3 Sections in order: Application → SMTP → S3 → Logs (each as a `<Card>`)
  - [ ] 7.4 No section for Backups, Crons, RateLimits, Batch, TrustedProxy

- [ ] Task 8: Add settings link to sidebar navigation
  - [ ] 8.1 Add "Settings" nav item (gear icon) in the sidebar, visible only to superusers
  - [ ] 8.2 Navigate to `/_app/_auth/_superuser/settings` path

## Dev Notes

### PB settings PATCH — merge-not-replace pattern
PocketBase's `PATCH /api/settings` **merges at the top level** (e.g., sending `{ smtp: {...} }` does not erase `s3`). However, within a section (e.g., `smtp`), the object is replaced entirely. Always spread current values and override:

```ts
// Safe merge pattern for meta section:
await pb.send('/api/settings', {
  method: 'PATCH',
  body: {
    meta: {
      ...currentSettings.meta,   // preserve senderName, senderAddress, hideControls
      appName: formData.appName,
      appURL:  formData.appURL,
    },
  },
})
```

### Test email body (PocketBase expects this shape)
```ts
pb.send('/api/settings/test/email', {
  method: 'POST',
  body: {
    template: { subject: 'Test email from AppOS', actionUrl: '', actionName: '' },
    to: [{ address: recipientEmail, name: '' }],
  },
})
```

### Logs minLevel select options
| Label | Value |
|-------|-------|
| DEBUG | `0` |
| INFO  | `5` |
| WARN  | `8` |
| ERROR | `9` |

### UI pattern
Follow `audit.tsx` for container/card/toast/Switch/loading-state patterns.

### Sidebar superuser check
Render Settings nav item only when `pb.authStore.record?.collectionName === '_superusers'` (same pattern as `_superuser.tsx`).

### References
- Superuser route guard: [dashboard/src/routes/_app/_auth/_superuser.tsx](dashboard/src/routes/_app/_auth/_superuser.tsx)
- Superuser route examples: [dashboard/src/routes/_app/_auth/_superuser/](dashboard/src/routes/_app/_auth/_superuser/)
- Page pattern: [dashboard/src/routes/_app/_auth/audit.tsx](dashboard/src/routes/_app/_auth/audit.tsx)
- PB settings API: https://pocketbase.io/docs/api-settings/
- Epic 13 PB fields: [specs/implementation-artifacts/epic13-settings.md](specs/implementation-artifacts/epic13-settings.md)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-5

### Debug Log References

### Completion Notes List

### File List
