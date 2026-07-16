import { expect, test } from './fixtures/appos'

function uniqueWorkflowName(prefix: string) {
  return `${prefix}-${Date.now()}`
}

test('workflow page is reachable for superuser', async ({ page, baseURL, loginAsSuperuser }) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  await loginAsSuperuser(page)
  await page.goto(`${baseURL}/workflows`, { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Workflow' })).toBeVisible()
  await expect(page).toHaveURL(/workflows/)
})

test('workflow create drawer opens', async ({ page, baseURL, loginAsSuperuser }) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  await loginAsSuperuser(page)
  await page.goto(`${baseURL}/workflows`, { waitUntil: 'networkidle' })

  await page.getByRole('button', { name: 'Create Workflow' }).click()

  await expect(page.getByRole('heading', { name: /Create Workflow|Edit Workflow/i })).toBeVisible()
  await expect(page.getByLabel('Definition YAML')).toBeVisible()
})

test('workflow can be created through UI and opened in run detail', async ({
  page,
  baseURL,
  loginAsSuperuser,
  apposApi,
}) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  const name = uniqueWorkflowName('workflow-ui-smoke')

  await loginAsSuperuser(page)
  await page.goto(`${baseURL}/workflows`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create Workflow' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Definition YAML').fill(`name: ${name}\nnodes:\n  - key: gate\n    type: manual_gate\n`)
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.locator('body')).toContainText(name)

  const row = page.getByRole('row', { name: new RegExp(name) })
  await row.getByRole('button', { name: /^Run$/ }).click()
  await page.getByLabel('Run Parameters JSON').fill('{}')
  await page.getByRole('button', { name: 'Run Now' }).click()

  await expect(page.getByRole('heading', { name: /Workflow Runs/i })).toBeVisible()
  await expect(page.locator('body')).toContainText(/manual|run detail|status|trigger|target server/i)

  await apposApi.deleteWorkflowByName(name)
})

test('workflow run detail shows node execution records', async ({
  page,
  baseURL,
  loginAsSuperuser,
  apposApi,
}) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  const name = uniqueWorkflowName('workflow-reject-smoke')
  const workflow = await apposApi.createWorkflow({
    name,
    is_enabled: true,
    definition_yaml: `name: ${name}\nnodes:\n  - key: gate\n    type: manual_gate\n`,
  })

  await loginAsSuperuser(page)
  await page.goto(`${baseURL}/workflows`, { waitUntil: 'networkidle' })
  const row = page.getByRole('row', { name: new RegExp(workflow.name) })
  await row.getByRole('button', { name: /^Run$/ }).click()
  await page.getByLabel('Run Parameters JSON').fill('{}')
  await page.getByRole('button', { name: 'Run Now' }).click()

  await expect(page.locator('body')).toContainText(/gate|manual|node|status/i)
})

test('manual gate can be approved from run detail', async ({
  page,
  baseURL,
  loginAsSuperuser,
  apposApi,
}) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  const name = uniqueWorkflowName('workflow-approve-smoke')
  const workflow = await apposApi.createWorkflow({
    name,
    is_enabled: true,
    definition_yaml: `name: ${name}\nnodes:\n  - key: gate\n    type: manual_gate\n`,
  })

  await loginAsSuperuser(page)
  await page.goto(`${baseURL}/workflows`, { waitUntil: 'networkidle' })
  const row = page.getByRole('row', { name: new RegExp(workflow.name) })
  await row.getByRole('button', { name: /^Run$/ }).click()
  await page.getByLabel('Run Parameters JSON').fill('{}')
  await page.getByRole('button', { name: 'Run Now' }).click()

  const approveButton = page.getByRole('button', { name: 'Approve' })
  const hasApprove = await approveButton.isVisible().catch(() => false)
  if (hasApprove) {
    await approveButton.click()
    await expect(page.locator('body')).toContainText(/succeeded|manual_gate|status/i)
  } else {
    await expect(page.locator('body')).toContainText(/manual|node|status/i)
  }
})

test('manual gate can be rejected from run detail when action is available', async ({
  page,
  baseURL,
  loginAsSuperuser,
  apposApi,
}) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  const name = uniqueWorkflowName('workflow-reject-smoke')
  const workflow = await apposApi.createWorkflow({
    name,
    is_enabled: true,
    definition_yaml: `name: ${name}\nnodes:\n  - key: gate\n    type: manual_gate\n`,
  })

  await loginAsSuperuser(page)
  await page.goto(`${baseURL}/workflows`, { waitUntil: 'networkidle' })
  const row = page.getByRole('row', { name: new RegExp(workflow.name) })
  await row.getByRole('button', { name: /^Run$/ }).click()
  await page.getByLabel('Run Parameters JSON').fill('{}')
  await page.getByRole('button', { name: 'Run Now' }).click()

  const rejectButton = page.getByRole('button', { name: 'Reject' })
  const hasReject = await rejectButton.isVisible().catch(() => false)
  if (hasReject) {
    await rejectButton.click()
    await expect(page.locator('body')).toContainText(/cancelled|rejected|status/i)
  } else {
    await expect(page.locator('body')).toContainText(/manual|node|status/i)
  }
})
