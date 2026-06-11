import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, test } from 'playwright/test'
import { _electron as playwrightElectron, type ElectronApplication, type Page } from 'playwright'

const REPO_ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(REPO_ROOT, 'out/main/index.js')
const DB_SCRIPT = path.join(REPO_ROOT, 'scripts/setup-test-db.ts')
const ELECTRON_CLI = path.join(REPO_ROOT, 'node_modules/electron/cli.js')
const ELECTRON_INSTALLER = path.join(REPO_ROOT, 'node_modules/electron/install.js')
const DOCS_SCREENSHOTS = {
  addConnectionFlow: path.join(REPO_ROOT, 'docs/screenshots/flow-add-connection.png'),
  queryEditorFlow: path.join(REPO_ROOT, 'docs/screenshots/flow-query-editor.png'),
  queryDataFlow: path.join(REPO_ROOT, 'docs/screenshots/flow-query-data.png'),
  connectionModal: path.join(REPO_ROOT, 'docs/screenshots/connection-modal.png'),
  mainWindow: path.join(REPO_ROOT, 'docs/screenshots/main-window.png'),
  queryEditor: path.join(REPO_ROOT, 'docs/screenshots/query-editor.png'),
  databaseVisualizer: path.join(REPO_ROOT, 'docs/screenshots/database-visualizer.png')
}

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

async function runSql(page: Page, sql: string, expectsRows = true): Promise<void> {
  const editor = page.locator('.cm-content').first()
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.type(sql)
  await page.locator('.run-btn').click()
  if (expectsRows) {
    await expect(page.locator('.results-pane .data-table')).toBeVisible()
  } else {
    await expect(page.getByText(/query executed successfully — no rows returned/i)).toBeVisible()
  }
}

function ensureElectronBinaryInstalled(): void {
  const install = spawnSync(process.execPath, [ELECTRON_INSTALLER], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: getSanitizedEnv()
  })

  expect(install.status, install.stderr || install.stdout).toBe(0)
}

test('renders users/posts/comments schema graph and captures docs screenshots', async () => {
  expect(fs.existsSync(MAIN_ENTRY)).toBe(true)
  expect(fs.existsSync(ELECTRON_INSTALLER)).toBe(true)
  ensureElectronBinaryInstalled()

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kobeansql-schema-viz-'))
  const testDbPath = path.join(tmpRoot, 'schema-visualizer.sqlite')
  const testHome = path.join(tmpRoot, 'home')

  const seed = spawnSync(process.execPath, [ELECTRON_CLI, DB_SCRIPT, testDbPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...getSanitizedEnv(),
      ELECTRON_RUN_AS_NODE: '1'
    }
  })
  expect(seed.status, seed.stderr || seed.stdout).toBe(0)
  expect(fs.existsSync(testDbPath)).toBe(true)

  let app: ElectronApplication | undefined
  try {
    const launched = await launchApp(testHome)
    app = launched.app
    const { page } = launched

    await expect(page.getByText('Welcome to KobeanSQL')).toBeVisible()
    await page.locator('.welcome-card').getByRole('button', { name: /new connection/i }).click()

    const connectionModalTitle = page.locator('.modal-title', { hasText: 'New Connection' })
    await expect(connectionModalTitle).toBeVisible()
    const sqliteCard = page.locator('.db-type-card', { hasText: 'SQLite' })
    await sqliteCard.click()
    await expect(sqliteCard).toHaveClass(/selected/)

    await page.locator('input[placeholder*="My SQLite DB"]').fill('Schema Visualizer E2E')
    await page.locator('input[placeholder*="/path/to/database.db"]').fill(testDbPath)

    await fs.promises.mkdir(path.dirname(DOCS_SCREENSHOTS.databaseVisualizer), { recursive: true })
    const connectionModal = page.locator('.modal-panel')
    await connectionModal.screenshot({ path: DOCS_SCREENSHOTS.addConnectionFlow })
    await connectionModal.screenshot({ path: DOCS_SCREENSHOTS.connectionModal })

    await page.getByRole('button', { name: /^connect & save$/i }).click()
    await expect(connectionModalTitle).toBeHidden()
    await expect(page.locator('.sidebar .connection-name', { hasText: 'Schema Visualizer E2E' })).toBeVisible()

    const mainLayout = page.locator('.main-layout')
    await expect(mainLayout).toBeVisible()
    await mainLayout.screenshot({ path: DOCS_SCREENSHOTS.mainWindow })

    const newTabButton = page.locator('.tab-new-btn').first()
    await expect(newTabButton).toBeVisible()
    await newTabButton.click()

    const connectionSelect = page.locator('.editor-connection-select')
    await expect(connectionSelect).toBeVisible()
    await connectionSelect.selectOption({ index: 1 })

    const contentPane = page.locator('.content-pane')
    await expect(contentPane).toBeVisible()
    await contentPane.screenshot({ path: DOCS_SCREENSHOTS.queryEditorFlow })

    await runSql(page, 'SELECT id, email, display_name FROM users ORDER BY id;')
    await contentPane.screenshot({ path: DOCS_SCREENSHOTS.queryDataFlow })
    await contentPane.screenshot({ path: DOCS_SCREENSHOTS.queryEditor })

    await runSql(page, "INSERT INTO users (email, display_name) VALUES ('charlie@example.com', 'Charlie');", false)
    await runSql(page, "SELECT display_name FROM users WHERE email = 'charlie@example.com';")
    await expect(page.locator('.results-pane .data-table')).toContainText('Charlie')

    await runSql(page, "UPDATE users SET display_name = 'Charles' WHERE email = 'charlie@example.com';", false)
    await runSql(page, "SELECT display_name FROM users WHERE email = 'charlie@example.com';")
    await expect(page.locator('.results-pane .data-table')).toContainText('Charles')

    await runSql(page, "DELETE FROM users WHERE email = 'charlie@example.com';", false)
    await runSql(page, 'SELECT COUNT(*) AS remaining_users FROM users;')
    await expect(page.locator('.results-pane .data-table')).toContainText('remaining_users')
    await expect(page.locator('.results-pane .data-table')).toContainText('2')

    await page.locator('button[data-tooltip="Schema Visualizer"]').click()

    const renderer = page.locator('.schema-visualizer-canvas .react-flow__renderer')
    await expect(renderer).toBeVisible()

    const nodeLocator = page.locator('.schema-visualizer-canvas .schema-table-node')
    await expect(nodeLocator).toHaveCount(3)
    await expect(page.locator('.schema-visualizer-canvas .schema-table-name', { hasText: 'users' })).toBeVisible()
    await expect(page.locator('.schema-visualizer-canvas .schema-table-name', { hasText: 'posts' })).toBeVisible()
    await expect(page.locator('.schema-visualizer-canvas .schema-table-name', { hasText: 'comments' })).toBeVisible()

    const edgePaths = page.locator('.schema-visualizer-canvas .react-flow__edge-path')
    await expect(edgePaths).toHaveCount(3)

    const canvasWrapper = page.locator('.schema-visualizer-canvas')
    await canvasWrapper.screenshot({ path: DOCS_SCREENSHOTS.databaseVisualizer })

  } finally {
    await app?.close()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
