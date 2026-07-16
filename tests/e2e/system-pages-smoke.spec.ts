import { test, expect } from './fixtures/appos'

const systemPages = [
  { path: '/status', heading: /Status|状态/i },
  { path: '/system-tasks', heading: /Platform Crons|平台计划任务/i },
  { path: '/logs', heading: /Logs|日志/i },
]

for (const systemPage of systemPages) {
  test(`system page ${systemPage.path} is reachable for superuser`, async ({
    page,
    baseURL,
    loginAsSuperuser,
  }) => {
    test.skip(!baseURL, 'APPOS_BASE_URL is required for browser smoke tests')

    await loginAsSuperuser(page)
    await page.goto(`${baseURL}${systemPage.path}`, { waitUntil: 'networkidle' })

    await expect(page).toHaveURL(new RegExp(systemPage.path.replace('/', '')))
    await expect(page.locator('body')).toContainText(systemPage.heading)
  })
}
