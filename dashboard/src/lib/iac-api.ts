// IaC API client — helpers for reading/writing files under /appos/data/
// Backend: GET|POST /api/ext/iac, PUT /api/ext/iac/content, POST /api/ext/iac/upload
// Requires superuser auth; callers should handle 401/403 gracefully.

import { pb } from '@/lib/pb'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IacEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  modified_at: string
}

export interface IacListResponse {
  path: string
  entries: IacEntry[]
}

export interface IacContentResponse {
  path: string
  content: string
  size: number
  modified_at: string
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function iacList(path: string): Promise<IacListResponse> {
  return pb.send<IacListResponse>(`/api/ext/iac?path=${encodeURIComponent(path)}`, {})
}

export async function iacRead(path: string): Promise<IacContentResponse> {
  return pb.send<IacContentResponse>(`/api/ext/iac/content?path=${encodeURIComponent(path)}`, {})
}

// ─── Library read-only (Story 5.5) ──────────────────────────────────────────

/** List entries in /appos/library/ (read-only). Path relative to library root, e.g. "apps/wordpress". */
export async function iacLibraryList(path: string): Promise<IacListResponse> {
  return pb.send<IacListResponse>(`/api/ext/iac/library?path=${encodeURIComponent(path)}`, {})
}

/** Read file content from /appos/library/ (read-only). */
export async function iacLibraryRead(path: string): Promise<IacContentResponse> {
  return pb.send<IacContentResponse>(`/api/ext/iac/library/content?path=${encodeURIComponent(path)}`, {})
}

/**
 * Load docker-compose.yml and .env from library/apps/{key}/.
 * Returns { compose, env } — each may be null if file doesn't exist.
 */
export async function iacLoadLibraryAppFiles(
  appKey: string,
): Promise<{ compose: string | null; env: string | null }> {
  const basePath = `apps/${appKey}`
  const [compose, env] = await Promise.allSettled([
    iacLibraryRead(`${basePath}/docker-compose.yml`),
    iacLibraryRead(`${basePath}/.env`),
  ])
  return {
    compose: compose.status === 'fulfilled' ? compose.value.content : null,
    env: env.status === 'fulfilled' ? env.value.content : null,
  }
}

/**
 * Copy library/apps/{sourceKey}/ → data/templates/{destKey}/ on the server.
 * If destKey is omitted, it defaults to sourceKey on the backend.
 * Returns true on success, false if the library app doesn't exist (404).
 */
export async function iacLibraryCopy(sourceKey: string, destKey?: string): Promise<boolean> {
  try {
    await pb.send('/api/ext/iac/library/copy', {
      method: 'POST',
      body: JSON.stringify({ sourceKey, destKey: destKey ?? sourceKey }),
      headers: { 'Content-Type': 'application/json' },
    })
    return true
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 404) return false
    throw err
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Create a directory (mkdir -p semantics). Ignores 409 if dir already exists. */
export async function iacMkdir(path: string): Promise<void> {
  try {
    await pb.send('/api/ext/iac', {
      method: 'POST',
      body: JSON.stringify({ path, type: 'dir' }),
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 409) return // directory already exists — OK
    throw err
  }
}

/** Create a new file with content. Fails if file already exists. */
export async function iacCreateFile(path: string, content: string): Promise<void> {
  await pb.send('/api/ext/iac', {
    method: 'POST',
    body: JSON.stringify({ path, type: 'file', content }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Overwrite an existing file. Fails with 404 if file does not exist. */
export async function iacWriteFile(path: string, content: string): Promise<void> {
  await pb.send('/api/ext/iac/content', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create or overwrite a file — tries PUT first, falls back to POST on 404.
 * This is the safe "upsert" for template files.
 */
export async function iacSaveFile(path: string, content: string): Promise<void> {
  try {
    await iacWriteFile(path, content)
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 404) {
      await iacCreateFile(path, content)
    } else {
      throw err
    }
  }
}

/** Upload a File object to a directory path. Uses multipart/form-data. */
export async function iacUploadFile(dirPath: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('path', dirPath)
  form.append('file', file)

  // pb.send handles the auth header; let fetch set Content-Type for multipart boundary.
  await pb.send('/api/ext/iac/upload', {
    method: 'POST',
    body: form,
  })
}

/** Delete a file or directory (recursive). */
export async function iacDelete(path: string, recursive = false): Promise<void> {
  await pb.send('/api/ext/iac', {
    method: 'DELETE',
    body: JSON.stringify({ path, recursive }),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Custom-app template helpers ─────────────────────────────────────────────

/**
 * Ensure `templates/apps/{key}/` exists and write compose, env, and readme files.
 * Always creates the three files (empty if no content provided).
 * IAC calls require superuser auth; errors are surfaced to caller (use try/catch).
 */
export async function iacEnsureCustomAppTemplate(
  key: string,
  composeYaml?: string,
  envText?: string,
): Promise<void> {
  const dir = `templates/apps/${key}`
  await iacMkdir(dir)

  // Always write the three skeleton files (empty string if no content)
  await iacSaveFile(`${dir}/docker-compose.yml`, composeYaml?.trim() ?? '')
  await iacSaveFile(`${dir}/.env`, envText?.trim() ?? '')
  await iacSaveFile(`${dir}/readme.md`, '')
}

/**
 * Upload extra files into `templates/apps/{key}/`.
 * Returns array of filenames that failed to upload.
 */
export async function iacUploadExtraFiles(key: string, files: File[]): Promise<string[]> {
  const dir = `templates/apps/${key}`
  const failed: string[] = []

  for (const file of files) {
    try {
      await iacUploadFile(dir, file)
    } catch {
      failed.push(file.name)
    }
  }
  return failed
}
