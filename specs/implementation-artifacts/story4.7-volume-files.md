# Story 4.7: Docker Volume Files

Status: draft

## Story

As an operator,
I want to open a Docker volume's files from the Volumes tab,
so that I can browse and edit simple volume files without switching to shell commands.

## MVP Scope

Volume `Open files` is a restricted, in-context entry into the existing Terminal > Files file-management experience.

Use the existing:

- `FileManagerPanel`
- `FileEditorDialog` Monaco editor
- existing SFTP file APIs

Do not create a separate volume-specific file editor.

Default backend decision: no new Docker volume file API is required for this MVP. Reuse the existing server file/SFTP APIs unless they cannot access the volume mountpoint in the deployed runtime.

## Acceptance Criteria

1. In `Server Detail > Docker > Volumes`, each volume keeps an `Open files` row action.
2. Clicking `Open files` opens a Docker-local dialog instead of navigating to Terminal Workspace.
3. The file panel starts at the volume `Mountpoint`.
4. The file panel is locked to the volume `Mountpoint` as its root path.
5. Users cannot navigate above the selected volume root through the volume entry point.
6. Path-based write operations in the reused file manager must also stay within the selected volume root.
7. Text files use the existing Monaco-based file editor.
8. File list, upload, create, rename, delete, and save behavior reuse the existing Files implementation where available.
9. No new backend API is required for this MVP unless existing SFTP file APIs cannot access the mountpoint.

## Backend API Decision

Do not add `/docker/volumes/{name}/files` APIs for the MVP.

The Volumes tab already has the volume `Mountpoint`, and file operations should go through the existing server file APIs:

```text
Volume Mountpoint
  -> Docker-local files dialog
  -> FileManagerPanel
  -> existing SFTP list/read/write APIs
```

Only revisit backend API work if the existing server file APIs cannot access Docker volume mountpoints because of permissions, path policy, or runtime isolation. If that happens, prefer improving the shared server file access path over creating Docker-volume-specific file APIs.

## UX Contract

```text
Volumes tab
  -> Open files
  -> Volume files dialog
  -> initialPath = volume.Mountpoint
  -> lockedRootPath = volume.Mountpoint
  -> browse and edit through existing Files UI
```

The user should stay in the Docker Volumes context while browsing files for one volume. The implementation should still reuse the same file manager and editor used by Terminal > Files.

## Safety Notes

- Volume files may be live application data.
- Editing database files, binary files, or files written by running containers can damage application state.
- The MVP should avoid special handling for every file type.
- A later enhancement may add a lightweight warning when editing files in a volume used by running containers.

## Non-Goals

- no dedicated Docker volume editor
- no new IDE-like workspace
- no multi-tab file editing
- no diff or version history
- no database-aware editing
- no compose-project file semantics
- no Space integration

## Dev Notes

- Prefer a small local dialog in Docker Volumes over routing to Terminal Workspace.
- Keep the volume root lock enforced for navigation and path-based mutations, not only breadcrumb/path browsing.
