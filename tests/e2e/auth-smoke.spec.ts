import { test, expect } from './fixtures/appos'

test('@smoke superuser can log in and reach overview', async ({ page, baseURL }) => {
  test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(/email/i).fill(process.env.APPOS_SUPERUSER_EMAIL || 'admin@websoft9.com')
  await page.getByLabel(/password/i).fill(process.env.APPOS_SUPERUSER_PASSWORD || 'changeme123')
  await page.getByRole('button', { name: /sign in|login|登录/i }).click()

  await expect(page).not.toHaveURL(/login/)
  await expect(page.locator('body')).toContainText(/overview|status|platform|workspace|总览|状态|平台/i)
})
