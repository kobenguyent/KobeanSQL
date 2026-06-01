import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Database, LayoutPanelLeft, Moon, Sun, Monitor, Info, Shield, Settings, Clock, Bug, GitBranch, Download, Terminal, Zap } from 'lucide-react'
import { useAppStore } from './store'
import { useIsLightTheme } from './hooks/useIsLightTheme'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { QueryEditor } from './components/QueryEditor'
import { ResultsTable } from './components/ResultsTable'
import { ConnectionModal } from './components/ConnectionModal'
import { SettingsModal } from './components/SettingsModal'
import { QueryHistoryPanel } from './components/QueryHistory'
import { SchemaVisualizer } from './components/SchemaVisualizer'
import { RenderGuard } from './components/RenderGuard'
import type { ConnectionConfig } from './types'
import { formatServerVersion } from './utils/version'
import { useTranslation } from './hooks/useTranslation'
import logoMarkLight from './assets/brand/kobeansql-logo-mark-light.svg'
import logoTitlebarLight from './assets/brand/kobeansql-logo-titlebar-light.svg'

// Read version from package.json (injected by Vite at build time)
const APP_VERSION = __APP_VERSION__
const UPDATE_STATUS_POLL_MS = 5 * 60 * 1000

function KobeanLogo({ className, src = logoMarkLight }: { className: string; src?: string }): React.JSX.Element {
  return (
    <span className={`brand-logo ${className}`} aria-hidden="true">
      <img className="brand-logo-img" src={src} alt="" />
    </span>
  )
}

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    tabs,
    activeTabId,
    connections,
    connectedIds,
    connectionVersions,
    statusMessage,
    statusType,
    updateStatus,
    settings,
    sidebarWidth,
    isSidebarCollapsed,
    theme,
    loadConnections,
    loadSavedQueries,
    loadSettings,
    loadHistory,
    loadUpdateStatus,
    newTab,
    runQuery,
    setSidebarWidth,
    setSidebarCollapsed,
    setTheme,
    openLogs,
    checkForUpdatesNow,
    dismissUpdateVersion,
    ignoreUpdateVersion,
    openUpdateRelease,
    downloadUpdate,
    installUpdate,
    setStatus
  } = useAppStore()

  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSchemaVisualizer, setShowSchemaVisualizer] = useState(false)
  const [closedUpdateVersion, setClosedUpdateVersion] = useState<string | null>(null)

  // Resize state
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // Vertical split state
  const [resultsPanelHeight, setResultsPanelHeight] = useState(240)
  const isSplitting = useRef(false)
  const splitStartY = useRef(0)
  const splitStartHeight = useRef(0)

  useEffect(() => {
    loadConnections()
    loadSavedQueries()
    loadSettings()
    loadHistory()
    loadUpdateStatus()
  }, [loadConnections, loadSavedQueries, loadSettings, loadHistory, loadUpdateStatus])

  useEffect(() => {
    if (!settings.updates.autoCheckEnabled) return
    const timer = window.setInterval(() => {
      loadUpdateStatus()
    }, UPDATE_STATUS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [loadUpdateStatus, settings.updates.autoCheckEnabled])

  useEffect(() => {
    const latest = updateStatus?.latestVersion ?? null
    if (!latest || !updateStatus?.shouldNotify) {
      setClosedUpdateVersion(null)
      return
    }
    setClosedUpdateVersion((previous) => {
      if (previous && previous !== latest) return null
      return previous
    })
  }, [updateStatus?.latestVersion, updateStatus?.shouldNotify])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        if (connections.length === 0) {
          setStatus('Add a connection before creating query tabs', 'warning')
          return
        }
        newTab()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [connections.length, newTab, setStatus])

  // Sidebar resize
  const startResize = useCallback((e: React.MouseEvent) => {
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = sidebarWidth

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = e.clientX - resizeStartX.current
      const newWidth = Math.max(180, Math.min(480, resizeStartWidth.current + delta))
      setSidebarWidth(newWidth)
    }
    const onMouseUp = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth, setSidebarWidth])

  // Results panel resize
  const startSplit = useCallback((e: React.MouseEvent) => {
    isSplitting.current = true
    splitStartY.current = e.clientY
    splitStartHeight.current = resultsPanelHeight

    const onMouseMove = (e: MouseEvent) => {
      if (!isSplitting.current) return
      const delta = splitStartY.current - e.clientY
      const newHeight = Math.max(80, Math.min(600, splitStartHeight.current + delta))
      setResultsPanelHeight(newHeight)
    }
    const onMouseUp = () => {
      isSplitting.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [resultsPanelHeight])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const isLightTheme = useIsLightTheme()

  const THEME_ORDER: Array<'dark' | 'light' | 'system' | 'matrix' | 'cyberpunk'> = ['dark', 'light', 'system', 'matrix', 'cyberpunk']
  const THEME_CLASS: Record<string, string> = { matrix: 'theme-matrix', cyberpunk: 'theme-cyberpunk' }
  const THEME_ICON: Record<string, React.ReactNode> = {
    dark: <Moon size={15} />,
    light: <Sun size={15} />,
    system: <Monitor size={15} />,
    matrix: <Terminal size={15} />,
    cyberpunk: <Zap size={15} />,
  }

  const handleOpenModal = (config?: ConnectionConfig) => {
    setEditingConnection(config ?? null)
    setShowConnectionModal(true)
  }

  const portalTarget =
    typeof document !== 'undefined'
      ? document.body ?? document.getElementById('root')
      : null
  const renderPortal = (node: React.ReactNode): React.ReactNode => {
    return portalTarget ? createPortal(node, portalTarget) : node
  }

  const renderModalRecoveryFallback = (panelName: string) => (error: Error | null) => (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <span className="modal-title">{panelName} crashed</span>
          <button className="icon-btn" onClick={() => { setShowHistory(false); setShowSchemaVisualizer(false) }}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            This panel failed to render. Close and reopen it, or restart the app if needed.
          </p>
          {error?.message && (
            <pre
              style={{
                margin: 0,
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--glass-border)',
                background: 'rgba(0,0,0,0.18)',
                color: 'var(--color-error)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {error.message}
            </pre>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => { setShowHistory(false); setShowSchemaVisualizer(false) }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className={`app-root${isLightTheme ? ' theme-light' : THEME_CLASS[theme] ? ` ${THEME_CLASS[theme]}` : ''}`}>
      {/* Title bar */}
      <div className="titlebar">
        <div className="titlebar-brand">
          <KobeanLogo className="titlebar-logo" src={logoTitlebarLight} />
          <span className="titlebar-name">KobeanSQL</span>
        </div>
        <div className="titlebar-actions">
          <button
            className="icon-btn"
            onClick={() => setShowHistory(true)}
            data-tooltip={t('app.queryHistory')}
          >
            <Clock size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSchemaVisualizer(true)}
            data-tooltip={t('app.schemaVisualizer')}
          >
            <GitBranch size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            data-tooltip={t('app.settings')}
          >
            <Settings size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              const idx = THEME_ORDER.indexOf(theme)
              setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length])
            }}
            data-tooltip={`Theme: ${theme}`}
          >
            {THEME_ICON[theme]}
          </button>
          <button
            className={`icon-btn ${isSidebarCollapsed ? '' : 'active'}`}
            onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
            data-tooltip={isSidebarCollapsed ? t('app.showSidebar') : t('app.hideSidebar')}
          >
            <LayoutPanelLeft size={15} />
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="main-layout">
        {/* Sidebar */}
        {!isSidebarCollapsed && (
          <>
            <div
              style={{ width: sidebarWidth, minWidth: sidebarWidth, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              <Sidebar onNewConnection={() => handleOpenModal()} onEditConnection={handleOpenModal} />
            </div>
            {/* Resize handle */}
            <div className="resize-handle" onMouseDown={startResize} />
          </>
        )}

        {/* Content area */}
        <div className="content-pane">
          {/* Tab bar */}
          <TabBar />

          {/* Query workspace */}
          {activeTab ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Editor */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <QueryEditor tab={activeTab} />
              </div>

              {/* Splitter */}
              <div className="pane-splitter" onMouseDown={startSplit} />

              {/* Results */}
              <div style={{ height: resultsPanelHeight, flexShrink: 0, overflow: 'hidden' }}>
                {activeTab.result ? (
                  <ResultsTable
                    result={activeTab.result}
                    connectionId={activeTab.connectionId}
                    tableName={activeTab.tabType === 'table' ? activeTab.title : undefined}
                    database={activeTab.database}
                    schema={activeTab.schema}
                    onRefresh={activeTab.tabType === 'table' ? () => runQuery(activeTab.id) : undefined}
                  />
                ) : (
                  <div className="results-pane" style={{ height: '100%', alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                      Run a query to see results
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : connections.length > 0 ? (
            /* Connections exist – prompt user to pick one */
            <div className="welcome-screen">
              <div className="welcome-card">
                <KobeanLogo className="welcome-logo" />
                <div className="welcome-title">KobeanSQL</div>
                <div className="welcome-sub">
                  You have {connections.length} saved connection{connections.length !== 1 ? 's' : ''}.
                  Select one from the sidebar to start querying, or open a new tab.
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => newTab()}>
                    <Database size={14} /> New Query Tab
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleOpenModal()}>
                    <Database size={14} /> Add Connection
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* No connections yet – first-run welcome */
            <div className="welcome-screen">
              <div className="welcome-card">
                <KobeanLogo className="welcome-logo" />
                <div className="welcome-title">Welcome to KobeanSQL</div>
                <div className="welcome-sub">
                  A modern SQL client with a beautiful glassmorphism interface.
                  Connect to MySQL, PostgreSQL, SQLite, or SQL Server.
                </div>
                <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                  <Database size={14} /> New Connection
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span className={`statusbar-msg ${statusType}`}>
          {statusMessage}
        </span>
        {/* Active connection info */}
        {(() => {
          const activeTab = tabs.find((t) => t.id === activeTabId)
          const conn = activeTab?.connectionId
            ? connections.find((c) => c.id === activeTab.connectionId)
            : null
          if (!conn || !connectedIds.has(conn.id)) return null
          const version = connectionVersions[conn.id]
          const displayVersion = version ? formatServerVersion(version) : null
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
              <span
                className="connection-dot connected"
                style={{ width: 6, height: 6, flexShrink: 0 }}
              />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{conn.name}</span>
              <span className={`connection-type-badge`} style={{ color: `var(--db-${conn.type})`, background: `color-mix(in srgb, var(--db-${conn.type}) 15%, transparent)` }}>
                {conn.type}
              </span>
              {conn.database && (
                <span style={{ color: 'var(--text-tertiary)' }}>
                  · {conn.database}
                </span>
              )}
              {displayVersion && version !== 'Unknown' && (
                <span style={{ color: 'var(--text-tertiary)' }}>
                  · {displayVersion}
                </span>
              )}
            </span>
          )
        })()}
        <span style={{ color: 'var(--text-tertiary)' }}>
          {connectedIds.size} connection{connectedIds.size !== 1 ? 's' : ''} active
        </span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          Built by JosephThien – KobeT · © {new Date().getFullYear()} · v{APP_VERSION}
        </span>
        <button
          className="icon-btn"
          onClick={() => checkForUpdatesNow()}
          data-tooltip={t('app.checkForUpdates')}
          style={{ width: 20, height: 20 }}
        >
          <Download size={12} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowPrivacy(true)}
          data-tooltip={t('privacy.title')}
          style={{ width: 20, height: 20 }}
        >
          <Shield size={12} />
        </button>
        <button
          className="icon-btn"
          onClick={() => openLogs()}
          data-tooltip={t('app.openLogs')}
          style={{ width: 20, height: 20 }}
        >
          <Bug size={12} />
        </button>
        <button
          className="icon-btn"
          onClick={() => window.open('https://kobenguyent.github.io/KobeanSQL/', '_blank')}
          data-tooltip={t('app.documentation')}
          style={{ width: 20, height: 20 }}
        >
          <Info size={12} />
        </button>
      </div>

      {updateStatus?.shouldNotify &&
        updateStatus.latestVersion &&
        closedUpdateVersion !== updateStatus.latestVersion && (
        <div
          style={{
            position: 'fixed',
            right: 20,
            bottom: 48,
            zIndex: 1200,
            maxWidth: 420,
            borderRadius: 12,
            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            background: 'color-mix(in srgb, var(--surface-elevated) 92%, black)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)'
          }}
        >
          <button
            className="icon-btn"
            onClick={() => setClosedUpdateVersion(updateStatus.latestVersion ?? null)}
            aria-label="Close update notification"
            style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20 }}
          >
            ✕
          </button>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', fontWeight: 600 }}>
            {t('updates.available', { version: updateStatus.latestVersion })}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            {t('updates.availableSub')}
          </div>

          {updateStatus.downloadState === 'downloading' && (
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>
                {updateStatus.downloadProgress != null && updateStatus.downloadProgress >= 0
                  ? t('updates.downloading', { progress: updateStatus.downloadProgress })
                  : t('updates.downloadingUnknown')}
              </div>
              <div style={{
                height: 4,
                background: 'var(--border-subtle)',
                borderRadius: 2,
                overflow: 'hidden'
              }}>
                {updateStatus.downloadProgress != null && updateStatus.downloadProgress >= 0 && (
                  <div style={{
                    height: '100%',
                    width: `${updateStatus.downloadProgress}%`,
                    background: 'var(--accent)',
                    transition: 'width 0.3s ease'
                  }} />
                )}
              </div>
            </div>
          )}

          {updateStatus.downloadState === 'error' && updateStatus.downloadError && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>
              {updateStatus.downloadError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {updateStatus.downloadState === 'ready' ? (
              <button
                className="btn btn-primary"
                onClick={() => installUpdate()}
                style={{ minHeight: 30 }}
              >
                {t('updates.installAndRestart')}
              </button>
            ) : updateStatus.downloadState === 'downloading' ? (
              <button className="btn btn-primary" disabled style={{ minHeight: 30 }}>
                {t('updates.downloadingUnknown')}
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => downloadUpdate()}
                  style={{ minHeight: 30 }}
                >
                  {t('updates.downloadUpdate')}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => openUpdateRelease(updateStatus.releaseUrl)}
                  style={{ minHeight: 30 }}
                >
                  {t('updates.viewRelease')}
                </button>
              </>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => dismissUpdateVersion(updateStatus.latestVersion)}
              style={{ minHeight: 30 }}
            >
              {t('updates.remindLater')}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => ignoreUpdateVersion(updateStatus.latestVersion)}
              style={{ minHeight: 30 }}
            >
              {t('updates.ignoreVersion')}
            </button>
          </div>
        </div>
      )}

      {/* Connection modal */}
      {showConnectionModal && (
        <ConnectionModal
          onClose={() => setShowConnectionModal(false)}
          editConfig={editingConnection}
        />
      )}

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Query history panel */}
      {showHistory && (
        <RenderGuard
          fallback={renderModalRecoveryFallback('Query History')}
          onError={(error) => {
            console.error('Query History render failure:', error)
            setStatus(`Query History failed: ${error.message}`, 'error')
          }}
        >
          <QueryHistoryPanel onClose={() => setShowHistory(false)} />
        </RenderGuard>
      )}

      {/* Schema visualizer */}
      {showSchemaVisualizer && (() => {
        return (
          <RenderGuard
            fallback={renderModalRecoveryFallback('Schema Visualizer')}
            onError={(error) => {
              console.error('Schema Visualizer render failure:', error)
              setStatus(`Schema Visualizer failed: ${error.message}`, 'error')
            }}
          >
            {(() => {
              const activeTab = tabs.find((t) => t.id === activeTabId)
              const conn = activeTab?.connectionId
                ? connections.find((c) => c.id === activeTab.connectionId)
                : connectedIds.size > 0
                  ? connections.find((c) => connectedIds.has(c.id))
                  : null
              if (!conn || !connectedIds.has(conn.id)) {
                return renderPortal(
                  <div className="modal-overlay" onClick={() => setShowSchemaVisualizer(false)}>
                    <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
                      <div className="modal-header">
                        <span className="modal-title">Schema Visualizer</span>
                        <button className="icon-btn" onClick={() => setShowSchemaVisualizer(false)}>✕</button>
                      </div>
                      <div className="modal-body">
                        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                          No active database connection. Connect to a database first.
                        </p>
                      </div>
                      <div className="modal-footer">
                        <button className="btn btn-secondary" onClick={() => setShowSchemaVisualizer(false)}>Close</button>
                      </div>
                    </div>
                  </div>
                )
              }
              return (
                <SchemaVisualizer
                  connectionId={conn.id}
                  connectionName={conn.name}
                  database={activeTab?.database ?? conn.database}
                  onClose={() => setShowSchemaVisualizer(false)}
                />
              )
            })()}
          </RenderGuard>
        )
      })()}

      {/* Privacy modal */}
      {showPrivacy && renderPortal(
        <div className="modal-overlay" onClick={() => setShowPrivacy(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <span className="modal-title">Privacy &amp; Data Collection</span>
              <button className="icon-btn" onClick={() => setShowPrivacy(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ gap: 12, lineHeight: 1.65, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              <p>
                <strong style={{ color: 'var(--text-primary)' }}>KobeanSQL does not collect any personal data.</strong>
              </p>
              <p>
                All database connection credentials and saved queries are stored locally on your
                machine using the operating system's user-data directory. No information is ever
                sent to external servers by KobeanSQL itself.
              </p>
              <p>
                KobeanSQL does <em>not</em> include analytics, telemetry, crash-reporting services,
                or any third-party tracking. Network traffic is only ever initiated by the database
                connections you explicitly configure.
              </p>
              <p>
                Optional update checks can contact GitHub Releases metadata to detect new versions.
                You can disable update checks at any time in Settings.
              </p>
              <p>
                AI features are strictly local-only and support local providers such as <strong style={{ color: 'var(--text-primary)' }}>Ollama</strong> and <strong style={{ color: 'var(--text-primary)' }}>OpenAI-compatible local servers</strong>.
                KobeanSQL does not send prompts or SQL to cloud AI providers.
              </p>
              <p>
                Built by <strong style={{ color: 'var(--text-primary)' }}>JosephThien – KobeT</strong>.
                Licensed under the MIT License.
              </p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                © {new Date().getFullYear()} kobenguyent. All rights reserved.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPrivacy(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
