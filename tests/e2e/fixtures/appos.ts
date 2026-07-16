import { expect, request, test as base, type APIRequestContext, type Page } from '@playwright/test'

type WorkflowRecord = {
  id: string
  name: string
  description?: string
  is_enabled: boolean
  definition_yaml: string
  default_server_id?: string
}

type ServerRecord = {
  id: string
  name: string
  host: string
  port: number
  user: string
}

type SecretRecord = {
  id: string
  name: string
}

type AssetRecord = {
  id: string
  name: string
  kind: 'script' | 'skill' | 'prompt'
}

type ApposApi = {
  token: string
  createWorkflow(payload: Partial<WorkflowRecord>): Promise<WorkflowRecord>
  deleteWorkflow(id: string): Promise<void>
  deleteWorkflowByName(name: string): Promise<void>
  listWorkflows(): Promise<WorkflowRecord[]>
  createServer(payload?: Partial<ServerRecord>): Promise<ServerRecord>
  deleteServer(id: string): Promise<void>
  createSecret(payload?: { name?: string; template_id?: string; scope?: string; payload?: Record<string, unknown> }): Promise<SecretRecord>
  deleteSecret(id: string): Promise<void>
  createAsset(payload: Partial<AssetRecord> & { definition_yaml?: never; content?: string; files?: Record<string, string> }): Promise<AssetRecord>
  deleteAsset(id: string): Promise<void>
}

type ApposFixtures = {
  apposApi: ApposApi
  loginAsSuperuser: (page?: Page) => Promise<void>
  superuserStorageState: string
}

const email = process.env.APPOS_SUPERUSER_EMAIL || 'admin@websoft9.com'
const password = process.env.APPOS_SUPERUSER_PASSWORD || 'changeme123'

async function authenticate(baseURL: string): Promise<string> {
  const authContext = await request.newContext({ baseURL })
  try {
    const response = await authContext.post('/api/collections/_superusers/auth-with-password', {
      data: {
        identity: email,
        password,
      },
    })
    expect(response.ok()).toBeTruthy()
    const body = (await response.json()) as { token: string }
    return body.token
  } finally {
    await authContext.dispose()
  }
}

export const test = base.extend<ApposFixtures>({
  apposApi: async ({ baseURL }, use) => {
    if (!baseURL) {
      await use({
        token: '',
        createWorkflow: async () => {
          throw new Error('APPOS_BASE_URL is required')
        },
        deleteWorkflow: async () => {
          throw new Error('APPOS_BASE_URL is required')
        },
        deleteWorkflowByName: async () => {
          throw new Error('APPOS_BASE_URL is required')
        },
        listWorkflows: async () => {
          throw new Error('APPOS_BASE_URL is required')
        },
      })
      return
    }

    const token = await authenticate(baseURL)
    const api = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${token}`,
      },
    })
    const createdWorkflowIDs = new Set<string>()
    const createdServerIDs = new Set<string>()
    const createdSecretIDs = new Set<string>()
    const createdAssetIDs = new Set<string>()

    const helper: ApposApi = {
      token,
      async createWorkflow(payload) {
        const response = await api.post('/api/workflows', { data: payload })
        expect(response.ok()).toBeTruthy()
        const body = (await response.json()) as WorkflowRecord
        createdWorkflowIDs.add(body.id)
        return body
      },
      async deleteWorkflow(id) {
        const response = await api.delete(`/api/workflows/${id}`)
        expect(response.ok()).toBeTruthy()
        createdWorkflowIDs.delete(id)
      },
      async deleteWorkflowByName(name) {
        const items = await helper.listWorkflows()
        const match = items.find(item => item.name === name)
        if (!match) return
        await helper.deleteWorkflow(match.id)
      },
      async listWorkflows() {
        const response = await api.get('/api/workflows')
        expect(response.ok()).toBeTruthy()
        const body = (await response.json()) as WorkflowRecord[]
        return Array.isArray(body) ? body : []
      },
      async createServer(payload = {}) {
        const response = await api.post('/api/servers', {
          data: {
            name: payload.name || `e2e-server-${Date.now()}`,
            host: payload.host || '127.0.0.1',
            port: payload.port || 22,
            user: payload.user || 'root',
            auth_type: 'password',
            is_enabled: true,
          },
        })
        expect(response.ok()).toBeTruthy()
        const body = (await response.json()) as ServerRecord
        createdServerIDs.add(body.id)
        return body
      },
      async deleteServer(id) {
        const response = await api.delete(`/api/servers/${id}`)
        expect(response.ok()).toBeTruthy()
        createdServerIDs.delete(id)
      },
      async createSecret(payload = {}) {
        const response = await api.post('/api/collections/secrets/records', {
          data: {
            name: payload.name || `e2e-secret-${Date.now()}`,
            template_id: payload.template_id || 'single_value',
            scope: payload.scope || 'global',
            payload_encrypted: '',
            payload_meta: {},
            payload: payload.payload || { value: 'demo' },
            status: 'active',
            version: 1,
            created_source: 'user',
            access_mode: 'use_only',
          },
        })
        expect(response.ok()).toBeTruthy()
        const body = (await response.json()) as SecretRecord
        createdSecretIDs.add(body.id)
        return body
      },
      async deleteSecret(id) {
        const response = await api.delete(`/api/collections/secrets/records/${id}`)
        expect(response.ok()).toBeTruthy()
        createdSecretIDs.delete(id)
      },
      async createAsset(payload) {
        const response = await api.post('/api/assets', {
          data: {
            name: payload.name || `e2e-asset-${Date.now()}`,
            kind: payload.kind || 'script',
            storage_kind: payload.kind === 'skill' ? 'folder' : 'file',
            source_kind: 'local',
            content: payload.content || 'echo smoke',
            files: payload.files,
          },
        })
        expect(response.ok()).toBeTruthy()
        const body = (await response.json()) as AssetRecord
        createdAssetIDs.add(body.id)
        return body
      },
      async deleteAsset(id) {
        const response = await api.delete(`/api/assets/${id}`)
        expect(response.ok()).toBeTruthy()
        createdAssetIDs.delete(id)
      },
    }

    await use(helper)

    for (const workflowID of createdWorkflowIDs) {
      await api.delete(`/api/workflows/${workflowID}`).catch(() => {})
    }
    for (const serverID of createdServerIDs) {
      await api.delete(`/api/servers/${serverID}`).catch(() => {})
    }
    for (const secretID of createdSecretIDs) {
      await api.delete(`/api/collections/secrets/records/${secretID}`).catch(() => {})
    }
    for (const assetID of createdAssetIDs) {
      await api.delete(`/api/assets/${assetID}`).catch(() => {})
    }
    await api.dispose()
  },

  loginAsSuperuser: async ({ page, baseURL }, use) => {
    await use(async (targetPage?: Page) => {
      if (!baseURL) {
        throw new Error('APPOS_BASE_URL is required')
      }
      const activePage = targetPage ?? page
      await activePage.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
      await activePage.getByLabel(/email/i).fill(email)
      await activePage.getByLabel(/password/i).fill(password)
      await activePage.getByRole('button', { name: /sign in|login|登录/i }).click()
      await expect(activePage).not.toHaveURL(/login/)
    })
  },

  superuserStorageState: async ({ browser, baseURL }, use) => {
    if (!baseURL) {
      await use('')
      return
    }
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|login|登录/i }).click()
    await expect(page).not.toHaveURL(/login/)
    const storageStatePath = 'test-results/superuser-storage-state.json'
    await context.storageState({ path: storageStatePath })
    await context.close()
    await use(storageStatePath)
  },
})

export { expect } from '@playwright/test'
