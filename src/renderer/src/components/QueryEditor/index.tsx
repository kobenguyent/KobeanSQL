import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang, StandardSQL } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { Play, StopCircle, Save, Wand2, Sparkles, Bot, X, MessageSquarePlus, Code2 } from 'lucide-react'
import { useAppStore } from '../../store'
import { useIsLightTheme } from '../../hooks/useIsLightTheme'
import { useTranslation } from '../../hooks/useTranslation'
import type { DatabaseType, QueryTab } from '../../types'
import { format } from 'sql-formatter'
import { buildProcedureCallSql, buildSelectTableSql } from '../../sql/dsl'

interface Props {
  tab: QueryTab
}

export function QueryEditor({ tab }: Props): React.JSX.Element {
  type SqlFormatterLanguage = 'mysql' | 'postgresql' | 'sqlite' | 'transactsql' | 'sql'

  const {
    connections,
    connectedIds,
    schema,
    settings,
    updateTabSql,
    updateTabConnection,
    runQuery,
    insertSnippet,
    saveCurrentQuery,
    setStatus
  } =
    useAppStore()
  const isLightTheme = useIsLightTheme()
  const { t } = useTranslation()
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCategory, setSaveCategory] = useState('')
  const [showDslModal, setShowDslModal] = useState(false)
  const [dslStatementType, setDslStatementType] = useState<'select' | 'procedure' | 'function'>('select')
  const [dslObjectName, setDslObjectName] = useState('')
  const [dslQualifier, setDslQualifier] = useState('')
  const [dslLimit, setDslLimit] = useState('100')
  const [aiBusyTask, setAiBusyTask] = useState<'generate' | 'explain' | 'optimize' | null>(null)
  const [aiOutput, setAiOutput] = useState<string | null>(null)
  const [showAIGenerateModal, setShowAIGenerateModal] = useState(false)
  const [aiGeneratePrompt, setAiGeneratePrompt] = useState('')
  const [aiSettings, setAiSettings] = useState<{
    provider: 'ollama' | 'openai-compatible'
    baseUrl: string
    model: string
    localOnly: true
  } | null>(null)

  useEffect(() => {
    let disposed = false
    window.db
      .getAISettings()
      .then((settings) => {
        if (!disposed) setAiSettings(settings)
      })
      .catch(() => {
        if (!disposed) setAiSettings(null)
      })
    return () => {
      disposed = true
    }
  }, [])

  const aiProviderName =
    aiSettings?.provider === 'openai-compatible' ? 'OpenAI-compatible local provider' : 'Ollama'
  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === tab.connectionId),
    [connections, tab.connectionId]
  )
  const activeDialectName = useMemo(() => {
    switch (activeConnection?.type) {
      case 'mysql':
        return 'MySQL'
      case 'mariadb':
        return 'MariaDB'
      case 'postgres':
        return 'PostgreSQL'
      case 'sqlite':
        return 'SQLite'
      case 'mssql':
        return 'SQL Server'
      case 'mongodb':
        return 'MongoDB'
      default:
        return 'SQL'
    }
  }, [activeConnection?.type])

  const handleRunQuery = useCallback(() => {
    if (!tab.isRunning) {
      runQuery(tab.id)
    }
  }, [tab.id, tab.isRunning, runQuery])

  const openSaveModal = useCallback(() => {
    setSaveName(tab.title || '')
    setSaveCategory('')
    setShowSaveModal(true)
  }, [tab.title])

  const handleSave = useCallback(async () => {
    if (!saveName.trim()) return
    await saveCurrentQuery(tab.id, saveName.trim(), saveCategory.trim() || undefined)
    setShowSaveModal(false)
    setSaveName('')
    setSaveCategory('')
  }, [saveCategory, saveCurrentQuery, saveName, tab.id])

  // Keyboard shortcuts: Ctrl/Cmd + Enter to run, Ctrl/Cmd + S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        handleRunQuery()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.repeat) return
        if (!tab.sql.trim()) return
        if (showSaveModal) {
          void handleSave()
          return
        }
        openSaveModal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleRunQuery, handleSave, openSaveModal, showSaveModal, tab.sql])

  // Build schema map for SQL autocomplete from connected schema
  const sqlSchema = useMemo(() => {
    if (!tab.connectionId) return {}
    const connSchema = schema[tab.connectionId]
    if (!connSchema) return {}
    const result: Record<string, string[]> = {}
    // Collect all tables from all databases
    for (const dbTables of Object.values(connSchema.tables)) {
      for (const tableInfo of dbTables) {
        result[tableInfo.name] = result[tableInfo.name] || []
      }
    }
    // Attach column names
    for (const [key, cols] of Object.entries(connSchema.columns)) {
      // key is "db.table" or "table"
      const parts = key.split('.')
      const tableName = parts.length > 1 ? parts[parts.length - 1] : key
      if (tableName && result[tableName]) {
        result[tableName] = cols.map((c) => c.name)
      }
    }
    return result
  }, [tab.connectionId, schema])

  const extensions = useMemo(
    () => [sqlLang({ dialect: StandardSQL, schema: sqlSchema, upperCaseKeywords: false })],
    [sqlSchema]
  )

  const getSqlLanguage = useCallback((dbType?: DatabaseType): SqlFormatterLanguage => {
    switch (dbType) {
      case 'mysql':
      case 'mariadb':
        return 'mysql'
      case 'postgres':
        return 'postgresql'
      case 'sqlite':
        return 'sqlite'
      case 'mssql':
        return 'transactsql'
      default:
        return 'sql'
    }
  }, [])

  const handleBeautifySql = useCallback(() => {
    if (!tab.sql.trim()) return
    if (activeConnection?.type === 'mongodb') {
      setStatus('Beautify SQL is not available for MongoDB queries', 'warning')
      return
    }
    try {
      const beautified = format(tab.sql, {
        language: getSqlLanguage(activeConnection?.type),
        keywordCase: 'upper'
      })
      updateTabSql(tab.id, beautified)
      setStatus('SQL beautified', 'success')
    } catch (error) {
      setStatus(`Unable to beautify SQL: ${(error as Error).message}`, 'warning')
    }
  }, [tab.sql, tab.id, activeConnection?.type, getSqlLanguage, updateTabSql, setStatus])

  const dslPreviewSql = useMemo(() => {
    const objectName = dslObjectName.trim()
    const qualifier = dslQualifier.trim() || undefined
    if (!activeConnection || !objectName) return ''
    if (dslStatementType === 'select') {
      const parsedLimit = Number.parseInt(dslLimit.trim(), 10)
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) return ''
      return buildSelectTableSql(activeConnection.type, objectName, qualifier, parsedLimit)
    }
    return buildProcedureCallSql(activeConnection.type, objectName, dslStatementType, qualifier)
  }, [activeConnection, dslObjectName, dslQualifier, dslLimit, dslStatementType])

  const openDslModal = useCallback(() => {
    setDslStatementType('select')
    setDslObjectName('')
    setDslQualifier('')
    setDslLimit(String(settings.queryLimit ?? 100))
    setShowDslModal(true)
  }, [settings.queryLimit])

  const handleInsertDslSql = useCallback(() => {
    if (!activeConnection) {
      setStatus('Select a connection to use the KobeanSQL DSL', 'warning')
      return
    }
    if (!dslPreviewSql) {
      setStatus('Complete the KobeanSQL DSL fields to generate SQL', 'warning')
      return
    }
    insertSnippet(tab.id, dslPreviewSql)
    setShowDslModal(false)
    setStatus(`KobeanSQL DSL SQL inserted for ${activeDialectName}`, 'success')
  }, [activeConnection, activeDialectName, dslPreviewSql, insertSnippet, setStatus, tab.id])

  const runAiTask = useCallback(
    async (task: 'generate' | 'explain' | 'optimize', generatePrompt?: string) => {
      const dbType = activeConnection?.type

      if (task === 'generate' && !generatePrompt?.trim()) {
        setStatus('Describe SQL requirements for AI generation', 'warning')
        return
      }
      if (task !== 'generate' && !tab.sql.trim()) {
        setStatus('Write SQL first for AI explain/optimize', 'warning')
        return
      }

      let response: { success: boolean; output?: string; error?: string }
      setAiBusyTask(task)
      try {
        response = await window.db.runAITask({
          task,
          prompt: generatePrompt?.trim(),
          sql: task === 'generate' ? undefined : tab.sql,
          dbType
        })
      } catch (error) {
        setStatus(`AI ${task} failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
        return
      } finally {
        setAiBusyTask(null)
      }

      if (!response.success || !response.output) {
        setStatus(`AI ${task} failed: ${response.error || 'unknown error'}`, 'error')
        return
      }

      if (task === 'explain') {
        setAiOutput(response.output)
        setStatus(`AI explanation ready (${aiProviderName})`, 'success')
        return
      }
      updateTabSql(tab.id, response.output)
      setStatus(task === 'optimize' ? `SQL optimized by ${aiProviderName}` : `SQL generated by ${aiProviderName}`, 'success')
    },
    [activeConnection?.type, aiProviderName, setStatus, tab.id, tab.sql, updateTabSql]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div className="editor-toolbar">
        {/* Connection selector */}
        <select
          className="editor-connection-select"
          value={tab.connectionId ?? ''}
          onChange={(e) => updateTabConnection(tab.id, e.target.value)}
        >
          <option value="" disabled>{t('editor.selectConnection')}</option>
          {connections.map((conn) => (
            <option key={conn.id} value={conn.id} disabled={!connectedIds.has(conn.id)}>
              {connectedIds.has(conn.id) ? '● ' : '○ '}{conn.name}
            </option>
          ))}
        </select>

        {/* Run button */}
        <button
          className={`run-btn ${tab.isRunning ? 'running' : ''}`}
          onClick={handleRunQuery}
          disabled={!tab.connectionId || !connectedIds.has(tab.connectionId ?? '')}
        >
          {tab.isRunning ? (
            <><StopCircle size={13} /> {t('editor.running')}</>
          ) : (
            <><Play size={13} fill="currentColor" /> {t('editor.run')}</>
          )}
        </button>

        {/* Save button */}
        <button
          className="icon-btn"
          onClick={openSaveModal}
          disabled={!tab.sql.trim()}
          data-tooltip={t('editor.saveQueryTooltip')}
          style={{ flexShrink: 0 }}
        >
          <Save size={13} />
        </button>
        <button className="icon-btn" onClick={handleBeautifySql} disabled={!tab.sql.trim()} data-tooltip={t('editor.beautify')}>
          <Wand2 size={13} />
        </button>
        <button
          className="icon-btn"
          onClick={openDslModal}
          disabled={!tab.connectionId}
          data-tooltip={`${t('editor.buildSql')} (${activeDialectName})`}
        >
          <Code2 size={13} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowAIGenerateModal(true)}
          disabled={aiBusyTask !== null}
          data-tooltip={`${t('editor.aiGenerate')} (${aiProviderName})`}
        >
          <MessageSquarePlus size={13} />
        </button>
        <button
          className="icon-btn"
          onClick={() => runAiTask('explain')}
          disabled={aiBusyTask !== null || !tab.sql.trim()}
          data-tooltip={`${t('editor.aiExplain')} (${aiProviderName})`}
        >
          <Bot size={13} />
        </button>
        <button
          className="icon-btn"
          onClick={() => runAiTask('optimize')}
          disabled={aiBusyTask !== null || !tab.sql.trim()}
          data-tooltip={`${t('editor.aiOptimize')} (${aiProviderName})`}
        >
          <Sparkles size={13} />
        </button>

        <span className="keyboard-hint">
          <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd> + <kbd>Enter</kbd>
        </span>
        <span className="keyboard-hint">
          <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</kbd> + <kbd>S</kbd>
        </span>
        <span className="keyboard-hint" style={{ color: 'var(--text-tertiary)' }}>
          AI: local-only ({aiProviderName})
        </span>
      </div>

      {/* CodeMirror editor */}
      <div className="cm-editor-wrapper">
        <CodeMirror
          value={tab.sql}
          height="100%"
          theme={isLightTheme ? 'light' : oneDark}
          extensions={extensions}
          onChange={(value) => updateTabSql(tab.id, value)}
          placeholder="-- Write your SQL query here…"
          style={{ height: '100%', fontFamily: 'var(--font-mono)' }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
            syntaxHighlighting: true
          }}
        />
      </div>

      {showDslModal && (
        <div className="modal-overlay" onClick={() => setShowDslModal(false)}>
          <div className="modal-panel" style={{ width: 460, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">KobeanSQL DSL Builder</span>
              <button className="icon-btn" onClick={() => setShowDslModal(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
                Generate dialect-aware SQL for the selected connection. The generated statement is inserted into the
                current tab and follows {activeDialectName} quoting and statement rules.
              </div>
              <div className="form-group">
                <label className="form-label">Statement type</label>
                <select
                  className="form-input"
                  value={dslStatementType}
                  onChange={(e) => setDslStatementType(e.target.value as 'select' | 'procedure' | 'function')}
                >
                  <option value="select">Select table / view</option>
                  <option value="procedure">Call procedure</option>
                  <option value="function">Call function</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{dslStatementType === 'select' ? 'Table or view name' : 'Routine name'}</label>
                <input
                  className="form-input"
                  type="text"
                  value={dslObjectName}
                  onChange={(e) => setDslObjectName(e.target.value)}
                  placeholder={dslStatementType === 'select' ? 'e.g. orders' : 'e.g. refresh_stats'}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Schema / database (optional)</label>
                <input
                  className="form-input"
                  type="text"
                  value={dslQualifier}
                  onChange={(e) => setDslQualifier(e.target.value)}
                  placeholder="e.g. public, reporting, salesdb"
                />
              </div>
              {dslStatementType === 'select' && (
                <div className="form-group">
                  <label className="form-label">Row limit</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1}
                    value={dslLimit}
                    onChange={(e) => setDslLimit(e.target.value)}
                    placeholder="100"
                  />
                </div>
              )}
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                {dslStatementType === 'select'
                  ? 'SQL Server uses SELECT TOP n; other supported dialects use LIMIT n.'
                  : dslStatementType === 'function'
                    ? 'Functions generate SELECT qualified_name().'
                    : 'Procedures generate EXEC on SQL Server and CALL on other supported dialects.'}
              </div>
              <div
                style={{
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--glass-bg-light)',
                  padding: 12,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xs)',
                  whiteSpace: 'pre-wrap',
                  minHeight: 76
                }}
              >
                {dslPreviewSql || '-- Fill out the builder to preview the generated SQL'}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowDslModal(false)}>
                {t('editor.cancel')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleInsertDslSql} disabled={!dslPreviewSql}>
                {t('editor.insert')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Query Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-panel" style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('editor.saveTitle')}</span>
              <button className="icon-btn" onClick={() => setShowSaveModal(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('editor.queryName')}</label>
                <input
                  className="form-input"
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="My query…"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('editor.queryCategory')}</label>
                <input
                  className="form-input"
                  type="text"
                  value={saveCategory}
                  onChange={(e) => setSaveCategory(e.target.value)}
                  placeholder="e.g. Analytics, Reporting…"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSaveModal(false)}>{t('editor.cancel')}</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!saveName.trim()}>
                {t('editor.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiOutput && (
        <div className="modal-overlay" onClick={() => setAiOutput(null)}>
          <div className="modal-panel" style={{ width: 520, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">AI SQL Explanation ({aiProviderName})</span>
              <button className="icon-btn" onClick={() => setAiOutput(null)}>
                <X size={15} />
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {aiOutput}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setAiOutput(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showAIGenerateModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowAIGenerateModal(false)}>
          <div className="modal-panel" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('editor.aiGenerate')} ({aiProviderName})</span>
              <button className="icon-btn" onClick={() => setShowAIGenerateModal(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('editor.aiPromptLabel')}</label>
                <textarea
                  className="form-input"
                  value={aiGeneratePrompt}
                  onChange={(e) => setAiGeneratePrompt(e.target.value)}
                  rows={5}
                  placeholder="e.g. Get the top 10 customers by revenue in the last 30 days."
                />
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                {t('editor.aiLocalOnly')} ({aiProviderName}).
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAIGenerateModal(false)}>
                {t('editor.cancel')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await runAiTask('generate', aiGeneratePrompt)
                  setShowAIGenerateModal(false)
                  setAiGeneratePrompt('')
                }}
                disabled={!aiGeneratePrompt.trim() || aiBusyTask !== null}
              >
                {t('editor.generate')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
