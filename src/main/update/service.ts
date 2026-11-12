import { app, net, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { appLogger } from '../logger'
import { loadSettings, saveSettings } from '../store'
import { isNewerVersion, normalizeVersion } from './version'

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/kobenguyent/KobeanSQL/releases/latest'
const RELEASES_PAGE_URL = 'https://github.com/kobenguyent/KobeanSQL/releases'
const FIRST_CHECK_DELAY_MS = 20_000
const MIN_RESCHEDULE_DELAY_MS = 10_000
// Keep "remind me later" temporary enough to avoid nagging every launch while still surfacing updates quickly.
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000
const FALLBACK_INTERVAL_HOURS = 24

/** Pattern matching GitHub asset names for each platform. */
const PLATFORM_ASSET_PATTERNS: Record<string, RegExp> = {
  win32: /\.exe$/i,
  darwin: /\.(dmg|zip)$/i,
  linux: /\.AppImage$/i
}
const ARCH_TOKEN_PATTERN = /\b(arm64|aarch64|x64|amd64)\b/i
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])
const MAX_DOWNLOAD_REDIRECTS = 5

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubLatestReleaseResponse {
  tag_name?: string
  html_url?: string
  name?: string
  assets?: GithubReleaseAsset[]
}

export interface UpdateStatus {
  checking: boolean
  enabled: boolean
  intervalHours: number
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseName?: string
  lastCheckedAt?: number
  ignoredVersion?: string
  dismissedVersion?: string
  dismissedAt?: number
  updateAvailable: boolean
  shouldNotify: boolean
  error?: string
  downloadState?: 'idle' | 'downloading' | 'ready' | 'error'
  downloadProgress?: number
  downloadError?: string
}

export interface UpdateService {
  initialize(): void
  reschedule(): void
  getStatus(): UpdateStatus
  checkForUpdates(manual?: boolean): Promise<UpdateStatus>
  ignoreVersion(version?: string): Promise<UpdateStatus>
  dismissVersion(version?: string): Promise<UpdateStatus>
  openReleasePage(url?: string): Promise<{ success: boolean; url: string }>
  downloadUpdate(): Promise<UpdateStatus>
  installUpdate(): Promise<{ success: boolean; error?: string }>
}

export function createUpdateService(): UpdateService {
  let checking = false
  let initialized = false
  let timer: NodeJS.Timeout | null = null
  let interval: NodeJS.Timeout | null = null
  let lastError: string | undefined

  // Download state
  let downloadState: 'idle' | 'downloading' | 'ready' | 'error' = 'idle'
  let downloadProgress = 0
  let downloadError: string | undefined
  let downloadedFilePath: string | undefined

  const clearSchedule = (): void => {
    if (timer) clearTimeout(timer)
    if (interval) clearInterval(interval)
    timer = null
    interval = null
  }

  const getIntervalMs = (intervalHours: number): number => {
    const safeHours = Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : FALLBACK_INTERVAL_HOURS
    return safeHours * 60 * 60 * 1000
  }

  const shouldNotify = (): boolean => {
    const settings = loadSettings()
    const { updates } = settings
    if (!updates.autoCheckEnabled) return false
    const latestVersion = updates.cache.latestVersion
    if (!latestVersion || !isNewerVersion(latestVersion, app.getVersion())) return false
    if (updates.ignoredVersion && normalizeVersion(updates.ignoredVersion) === normalizeVersion(latestVersion)) {
      return false
    }
    if (
      updates.dismissedVersion &&
      normalizeVersion(updates.dismissedVersion) === normalizeVersion(latestVersion) &&
      updates.dismissedAt &&
      Date.now() - updates.dismissedAt < DISMISS_TTL_MS
    ) {
      return false
    }
    return true
  }

  const toStatus = (): UpdateStatus => {
    const settings = loadSettings()
    const latestVersion = settings.updates.cache.latestVersion
    const updateAvailable = !!latestVersion && isNewerVersion(latestVersion, app.getVersion())
    return {
      checking,
      enabled: settings.updates.autoCheckEnabled,
      intervalHours: settings.updates.checkIntervalHours,
      currentVersion: app.getVersion(),
      latestVersion,
      releaseUrl: settings.updates.cache.releaseUrl,
      releaseName: settings.updates.cache.releaseName,
      lastCheckedAt: settings.updates.cache.checkedAt,
      ignoredVersion: settings.updates.ignoredVersion,
      dismissedVersion: settings.updates.dismissedVersion,
      dismissedAt: settings.updates.dismissedAt,
      updateAvailable,
      shouldNotify: updateAvailable ? shouldNotify() : false,
      error: lastError,
      downloadState,
      downloadProgress,
      downloadError
    }
  }

  const persistCheckCache = (partial: {
    latestVersion?: string
    releaseUrl?: string
    releaseName?: string
    checkedAt: number
    etag?: string
    downloadUrl?: string
  }): void => {
    const settings = loadSettings()
    saveSettings({
      ...settings,
      updates: {
        ...settings.updates,
        cache: {
          ...settings.updates.cache,
          ...partial
        }
      }
    })
  }

  /** Pick the platform-appropriate asset URL from a GitHub release, if available. */
  const pickDownloadUrl = (assets: GithubReleaseAsset[] | undefined): string | undefined => {
    if (!assets || assets.length === 0) return undefined
    const pattern = PLATFORM_ASSET_PATTERNS[process.platform]
    if (!pattern) return undefined
    const allEligible = assets.filter((a) => pattern.test(a.name))
    // Prefer Electron release assets over the standalone SwiftUI native macOS bundle when both are attached
    const nonNativeEligible = allEligible.filter((a) => !/macos-native/i.test(a.name))
    const eligible = nonNativeEligible.length > 0 ? nonNativeEligible : allEligible
    if (eligible.length === 0) return undefined

    if (process.platform === 'darwin') {
      const arch = process.arch
      const archMatcher =
        arch === 'arm64'
          ? /\b(arm64|aarch64)\b/i
          : arch === 'x64'
            ? /\b(x64|amd64)\b/i
            : undefined
      if (archMatcher) {
        const archSpecificZip = eligible.find((a) => archMatcher.test(a.name) && /\.zip$/i.test(a.name))
        if (archSpecificZip) return archSpecificZip.browser_download_url
        const archSpecificDmg = eligible.find((a) => archMatcher.test(a.name) && /\.dmg$/i.test(a.name))
        if (archSpecificDmg) return archSpecificDmg.browser_download_url
      }

      const genericZip = eligible.find((a) => /\.zip$/i.test(a.name) && !ARCH_TOKEN_PATTERN.test(a.name))
      if (genericZip) return genericZip.browser_download_url

      const genericDmg = eligible.find((a) => /\.dmg$/i.test(a.name) && !ARCH_TOKEN_PATTERN.test(a.name))
      if (genericDmg) return genericDmg.browser_download_url

      if (archMatcher) {
        const archSpecific = eligible.find((a) => archMatcher.test(a.name))
        if (archSpecific) return archSpecific.browser_download_url
      }
    }

    const asset = eligible[0]
    return asset?.browser_download_url
  }

  const isAllowedDownloadUrl = (u?: string): boolean => {
    if (!u) return false
    try {
      const parsed = new URL(u)
      return parsed.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)
    } catch {
      return false
    }
  }

  const fetchDownloadResponse = async (url: string): Promise<Response> => {
    let currentUrl = url

    for (let redirectCount = 0; redirectCount < MAX_DOWNLOAD_REDIRECTS; redirectCount += 1) {
      if (!isAllowedDownloadUrl(currentUrl)) {
        throw new Error('Invalid download URL.')
      }

      const response = await fetch(currentUrl, {
        headers: { 'User-Agent': 'KobeanSQL-Update-Checker' },
        redirect: 'manual'
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new Error('Download redirect missing location.')
        }
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }

      return response
    }

    throw new Error('Too many download redirects.')
  }

  const fetchLatestRelease = async (force = false): Promise<void> => {
    const settings = loadSettings()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'KobeanSQL-Update-Checker'
    }
    if (!force && settings.updates.cache.etag) {
      headers['If-None-Match'] = settings.updates.cache.etag
    }

    const response = await fetch(LATEST_RELEASE_API_URL, { headers })
    const checkedAt = Date.now()
    if (response.status === 304) {
      persistCheckCache({
        checkedAt,
        etag: response.headers.get('etag') ?? settings.updates.cache.etag
      })
      return
    }
    if (!response.ok) {
      throw new Error(`Update check failed (${response.status})`)
    }

    const body = (await response.json()) as GithubLatestReleaseResponse
    const latestVersion = body.tag_name ? normalizeVersion(body.tag_name) : undefined
    if (!latestVersion) {
      throw new Error('Release metadata missing tag_name')
    }

    persistCheckCache({
      latestVersion,
      releaseUrl: body.html_url || RELEASES_PAGE_URL,
      releaseName: body.name || undefined,
      checkedAt,
      etag: response.headers.get('etag') ?? undefined,
      downloadUrl: pickDownloadUrl(body.assets)
    })
  }

  const shouldSkipCheck = (manual: boolean): { skip: boolean; reason?: string } => {
    const settings = loadSettings()
    if (is.dev) {
      return { skip: true, reason: 'Update checks are disabled in development mode' }
    }
    if (!manual && !settings.updates.autoCheckEnabled) {
      return { skip: true, reason: undefined }
    }
    if (!net.isOnline()) {
      return { skip: true, reason: manual ? 'No network connectivity' : undefined }
    }
    return { skip: false }
  }

  const checkForUpdates = async (manual = false): Promise<UpdateStatus> => {
    if (checking) return toStatus()
    const skip = shouldSkipCheck(manual)
    if (skip.skip) {
      lastError = skip.reason
      return toStatus()
    }
    checking = true
    try {
      await fetchLatestRelease()
      lastError = undefined
    } catch (error) {
      const message = (error as Error).message || 'network error'
      lastError = `Failed to check for updates: ${message}`
      appLogger.warn('Update check failed', { error: lastError })
    } finally {
      checking = false
    }
    return toStatus()
  }

  const scheduleChecks = (): void => {
    clearSchedule()
    const settings = loadSettings()
    if (!settings.updates.autoCheckEnabled || is.dev) return

    const intervalMs = getIntervalMs(settings.updates.checkIntervalHours)
    const checkedAt = settings.updates.cache.checkedAt
    const elapsedMs = checkedAt ? Date.now() - checkedAt : null
    let firstDelay = FIRST_CHECK_DELAY_MS
    if (elapsedMs !== null && elapsedMs < intervalMs) {
      firstDelay = Math.max(MIN_RESCHEDULE_DELAY_MS, intervalMs - elapsedMs)
    }

    timer = setTimeout(() => {
      void checkForUpdates(false).then(() => {
        interval = setInterval(() => {
          void checkForUpdates(false)
        }, intervalMs)
      })
    }, firstDelay)
  }

  return {
    initialize(): void {
      if (initialized) return
      initialized = true
      scheduleChecks()
    },
    reschedule(): void {
      scheduleChecks()
    },
    getStatus(): UpdateStatus {
      return toStatus()
    },
    checkForUpdates,
    async ignoreVersion(version?: string): Promise<UpdateStatus> {
      const settings = loadSettings()
      const target = normalizeVersion(version || settings.updates.cache.latestVersion || '')
      if (!target) return toStatus()
      saveSettings({
        ...settings,
        updates: {
          ...settings.updates,
          ignoredVersion: target,
          dismissedVersion: undefined,
          dismissedAt: undefined
        }
      })
      return toStatus()
    },
    async dismissVersion(version?: string): Promise<UpdateStatus> {
      const settings = loadSettings()
      const target = normalizeVersion(version || settings.updates.cache.latestVersion || '')
      if (!target) return toStatus()
      saveSettings({
        ...settings,
        updates: {
          ...settings.updates,
          dismissedVersion: target,
          dismissedAt: Date.now()
        }
      })
      return toStatus()
    },
    async openReleasePage(url?: string): Promise<{ success: boolean; url: string }> {
      const settings = loadSettings()
      const cachedUrl = settings.updates.cache.releaseUrl
      // Only allow https GitHub release URLs; fall back to known-safe constants
      const isAllowedUrl = (u?: string): boolean => {
        if (!u) return false
        try {
          const parsed = new URL(u)
          return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
        } catch {
          return false
        }
      }
      const target = isAllowedUrl(url) ? url! : (isAllowedUrl(cachedUrl) ? cachedUrl! : RELEASES_PAGE_URL)
      await shell.openExternal(target)
      return { success: true, url: target }
    },

    async downloadUpdate(): Promise<UpdateStatus> {
      if (downloadState === 'downloading') return toStatus()

      downloadState = 'downloading'
      downloadProgress = 0
      downloadError = undefined

      const settings = loadSettings()
      let dlUrl = settings.updates.cache.downloadUrl
      if (!dlUrl) {
        // downloadUrl may be missing if this is a legacy cache entry that predates
        // the field, or if the prior check returned 304 without assets. Force a
        // fresh fetch (bypassing ETag) so we always have the latest asset list.
        try {
          await fetchLatestRelease(true)
          dlUrl = loadSettings().updates.cache.downloadUrl
        } catch {
          // ignore — fall through to the error path below
        }
      }
      if (!dlUrl) {
        downloadState = 'error'
        downloadError = 'No download URL available for this platform. Please visit the releases page.'
        return toStatus()
      }

      if (!isAllowedDownloadUrl(dlUrl)) {
        downloadState = 'error'
        downloadError = 'Invalid download URL.'
        return toStatus()
      }

      const filename = dlUrl.split('/').pop() ?? 'kobeansql-update'
      const destDir = path.join(app.getPath('temp'), 'kobeansql-update')
      const destPath = path.join(destDir, filename)

      try {
        await fs.promises.mkdir(destDir, { recursive: true })
        const response = await fetchDownloadResponse(dlUrl)
        if (!response.ok) {
          throw new Error(`Download failed (${response.status})`)
        }
        const total = parseInt(response.headers.get('content-length') ?? '0', 10)
        const dest = fs.createWriteStream(destPath)

        await new Promise<void>((resolve, reject) => {
          let settled = false
          const cleanup = () => {
            dest.off('finish', handleFinish)
            dest.off('error', handleError)
          }
          const handleFinish = () => {
            if (settled) return
            settled = true
            cleanup()
            resolve()
          }
          const handleError = (err: Error) => {
            if (settled) return
            settled = true
            cleanup()
            if (!dest.destroyed) {
              dest.destroy()
            }
            reject(err)
          }

          dest.once('finish', handleFinish)
          dest.once('error', handleError)

          if (!response.body) {
            handleError(new Error('No response body'))
            return
          }
          const reader = response.body.getReader()
          let downloaded = 0

          const pump = async (): Promise<void> => {
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                downloaded += value.length
                downloadProgress = total > 0 ? Math.round((downloaded / total) * 100) : -1
                await new Promise<void>((res, rej) => {
                  dest.write(value, (err) => (err ? rej(err) : res()))
                })
              }
              dest.end()
            } catch (err) {
              handleError(err instanceof Error ? err : new Error(String(err)))
            }
          }

          void pump().catch((err) => {
            handleError(err instanceof Error ? err : new Error(String(err)))
          })
        })

        downloadedFilePath = destPath
        downloadState = 'ready'
        downloadProgress = 100
        appLogger.info('Update downloaded', { path: destPath })
      } catch (error) {
        downloadState = 'error'
        downloadError = (error as Error).message || 'Download failed'
        appLogger.warn('Update download failed', { error: downloadError })
        try { await fs.promises.unlink(destPath) } catch { /* ignore */ }
      }

      return toStatus()
    },

    async installUpdate(): Promise<{ success: boolean; error?: string }> {
      if (downloadState !== 'ready' || !downloadedFilePath) {
        return { success: false, error: 'No update ready to install.' }
      }
      try {
        const ext = path.extname(downloadedFilePath).toLowerCase()
        const updateDir = path.dirname(downloadedFilePath)
        // How long to wait (in seconds) for the Electron process to exit before
        // the update script proceeds.  Must be long enough for app.quit() + the
        // IPC reply round-trip to complete.
        const APP_QUIT_GRACE_SECS = 3
        // Delay before calling app.quit() so the renderer can receive the IPC
        // reply and show any transitional UI.
        const QUIT_DELAY_MS = 300

        /** Escape a value for safe embedding inside a double-quoted shell string. */
        const shEscape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')

        if (process.platform === 'darwin' && ext === '.zip') {
          // Derive the current app bundle path: .../AppName.app/Contents/MacOS/exe → .../AppName.app
          const currentAppBundle = path.resolve(app.getPath('exe'), '..', '..', '..')
          // Guard: only proceed if the derived path ends with .app to avoid
          // accidentally deleting unrelated directories.
          if (!currentAppBundle.endsWith('.app')) {
            return { success: false, error: 'Could not determine app bundle path for installation.' }
          }
          const installDir = path.dirname(currentAppBundle)
          const appBundleName = path.basename(currentAppBundle) // e.g. "KobeanSQL.app"
          const zipPath = downloadedFilePath

          // Write a shell script that waits for the app to quit, extracts the
          // zip, replaces the current app bundle, and reopens the new version.
          const scriptPath = path.join(updateDir, 'kobeansql-update.sh')
          const script = [
            '#!/bin/bash',
            `sleep ${APP_QUIT_GRACE_SECS}`,
            `unzip -o "${shEscape(zipPath)}" -d "${shEscape(updateDir)}/" 2>/dev/null`,
            // Prefer an exact name match; fall back to any .app in the directory.
            `NEW_APP=$(find "${shEscape(updateDir)}" -maxdepth 2 -name "${shEscape(appBundleName)}" 2>/dev/null | head -1)`,
            `[ -z "$NEW_APP" ] && NEW_APP=$(find "${shEscape(updateDir)}" -maxdepth 2 -name "*.app" 2>/dev/null | head -1)`,
            'if [ -n "$NEW_APP" ]; then',
            `  rm -rf "${shEscape(currentAppBundle)}"`,
            `  cp -R "$NEW_APP" "${shEscape(installDir)}/"`,
            `  open "${shEscape(installDir)}/${shEscape(appBundleName)}"`,
            'fi',
          ].join('\n')
          await fs.promises.writeFile(scriptPath, script, { mode: 0o755 })

          const child = spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' })
          child.unref()

          downloadState = 'idle'
          downloadProgress = 0
          downloadedFilePath = undefined
          setTimeout(() => app.quit(), QUIT_DELAY_MS)
          return { success: true }
        }

        if (process.platform === 'win32' && ext === '.exe') {
          // Spawn the installer as a detached process; it will handle replacing
          // the old installation and optionally relaunching the app.
          const child = spawn(downloadedFilePath, [], { detached: true, stdio: 'ignore' })
          child.unref()

          downloadState = 'idle'
          downloadProgress = 0
          downloadedFilePath = undefined
          setTimeout(() => app.quit(), QUIT_DELAY_MS)
          return { success: true }
        }

        if (process.platform === 'linux' && ext === '.appimage') {
          // Replace the currently running AppImage in-place and relaunch it.
          const currentExe = app.getPath('exe')
          await fs.promises.chmod(downloadedFilePath, 0o755)

          const scriptPath = path.join(updateDir, 'kobeansql-update.sh')
          const newFilePath = downloadedFilePath
          const script = [
            '#!/bin/bash',
            `sleep ${APP_QUIT_GRACE_SECS}`,
            `cp -f "${shEscape(newFilePath)}" "${shEscape(currentExe)}"`,
            `chmod +x "${shEscape(currentExe)}"`,
            `"${shEscape(currentExe)}" &`,
          ].join('\n')
          await fs.promises.writeFile(scriptPath, script, { mode: 0o755 })

          const child = spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' })
          child.unref()

          downloadState = 'idle'
          downloadProgress = 0
          downloadedFilePath = undefined
          setTimeout(() => app.quit(), QUIT_DELAY_MS)
          return { success: true }
        }

        // Fallback for other file types (e.g. macOS .dmg): open with OS handler.
        const openError = await shell.openPath(downloadedFilePath)
        if (openError) {
          return { success: false, error: openError }
        }
        // Reset download state after handing off to OS installer, then quit
        // so the installer runs without a stale instance remaining open.
        downloadState = 'idle'
        downloadProgress = 0
        downloadedFilePath = undefined
        // Give the renderer ~300 ms to receive the IPC reply and render any
        // transitional UI before the process exits.  This is a best-effort
        // courtesy flush; Electron's IPC layer does not expose a "reply
        // acknowledged" callback, so a short fixed delay is the standard
        // pattern for this use-case.
        setTimeout(() => app.quit(), QUIT_DELAY_MS)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  }
}
