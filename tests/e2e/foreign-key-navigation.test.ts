import { test, expect } from 'playwright/test'
import { _electron as playwrightElectron, type ElectronApplication, type Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import { spawnSync } from 'child_process'

const REPO_ROOT = path.resolve(__dirname, '../..')
const MAIN_ENTRY = path.join(REPO_ROOT, 'out/main/index.js')
const DB_SCRIPT = path.join(REPO_ROOT, 'scripts/setup-test-db.ts')
const ELECTRON_CLI = path.join(REPO_ROOT, 'node_modules/electron/cli.js')

function getSanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (env.NODE_OPTIONS) {
    env.NODE_OPTIONS = env.NODE_OPTIONS.replace('--openssl-legacy-provider', '').trim()
    if (!env.NODE_OPTIONS) {
      delete env.NODE_OPTIONS
    }
  }
  return env
}

async function launchApp(homeDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await playwrightElectron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${path.join(homeDir, 'user-data')}`],
    env: {
      ...getSanitizedEnv(),
      HOME: homeDir,
      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
      ELECTRON_DISABLE_SANDBOX: '1'
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

test.describe('Foreign Key Navigation', () => {
  let tempDir: string
  let testDbPath: string

  test.beforeAll(async () => {
    tempDir = path.join(REPO_ROOT, '.tmp', `fk-nav-test-${Date.now()}`)
    testDbPath = path.join(tempDir, 'test.sqlite')
    fs.mkdirSync(tempDir, { recursive: true })

    const seed = spawnSync(process.execPath, [ELECTRON_CLI, DB_SCRIPT, testDbPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...getSanitizedEnv(),
        ELECTRON_RUN_AS_NODE: '1'
      }
    })
    if (seed.status !== 0) {
      throw new Error(`Failed to seed DB: ${seed.stderr || seed.stdout}`)
    }
  })

  test.afterAll(async () => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('navigates to referenced table when clicking a foreign key value', async () => {
    const { app, page } = await launchApp(tempDir)

    try {
      await expect(page.getByText('Welcome to KobeanSQL')).toBeVisible()
      await page.locator('.welcome-card').getByRole('button', { name: /new connection/i }).click()

      await page.locator('.db-type-card', { hasText: 'SQLite' }).click()
      await page.locator('input[placeholder*="My SQLite DB"]').fill('FK Test DB')
      await page.locator('input[placeholder*="/path/to/database.db"]').fill(testDbPath)
      await page.getByRole('button', { name: 'Connect & Save', exact: true }).click()

      // Wait for sidebar to load tables
      await page.locator('.sidebar-body').getByText('FK Test DB', { exact: true }).click()
      await page.waitForTimeout(2000)
      
      // Expand the 'main' database
      await page.locator('.sidebar-body').getByText('main', { exact: true }).click()
      await page.waitForTimeout(2000)
      
      // Expand 'Tables (3)'
      await page.locator('.sidebar-body').getByText('Tables (3)', { exact: true }).click()
      await page.waitForTimeout(2000)
      
      // Try to find the 'posts' table
      const postsItem = page.locator('.sidebar-body').getByText('posts', { exact: true })
      await expect(postsItem).toBeVisible({ timeout: 15000 })
      await postsItem.click()

      // Should open posts table
      await expect(page.locator('.tab.active')).toContainText('posts')
      
      // Wait for data to load
      await page.waitForTimeout(3000)
      
      // Find and click the 'Follow FK' button
      const fkButton = page.locator('.cell-action-btn[title^="Follow FK"]').first()
      await expect(fkButton).toBeVisible({ timeout: 15000 })
      await fkButton.click()

      // Should open users table in a new tab
      await expect(page.locator('.tab.active')).toContainText('users')
      
      // Should be filtered by id=1
      // Check the filter in ResultsTable if possible, or just check the data
      await expect(page.locator('.data-table td', { hasText: 'alice@example.com' })).toBeVisible()
      await expect(page.locator('.data-table td', { hasText: 'bob@example.com' })).not.toBeVisible()

    } finally {
      await app.close()
    }
  })
})
