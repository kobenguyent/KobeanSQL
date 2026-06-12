import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, Table, Code2, FunctionSquare, Database } from 'lucide-react'
import { useAppStore } from '../../store'
import { useThemeClass } from '../../hooks/useThemeClass'
import type { QueryTab } from '../../types'
import { DB_COLORS } from '../../types'

const TAB_COLORS = ['#7c3aed', '#2563eb', '#0f766e', '#15803d', '#b45309', '#be123c']
const GROUP_COLORS = ['#8b5cf6', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ec4899']

function TabIcon({ tabType }: { tabType: 'query' | 'table' | 'procedure' | undefined }): React.JSX.Element {
  if (tabType === 'table') return <Table size={11} style={{ flexShrink: 0, opacity: 0.8 }} />
  if (tabType === 'procedure') return <FunctionSquare size={11} style={{ flexShrink: 0, opacity: 0.8 }} />
  return <Code2 size={11} style={{ flexShrink: 0, opacity: 0.8 }} />
}

export function TabBar(): React.JSX.Element {
  const {
    tabs,
    activeTabId,
    connections,
    newTab,
    closeTab,
    setActiveTab,
    moveTab,
    moveTabBlock,
    saveCurrentQuery,
    setTabColor,
    setTabGroup,
    setStatus
  } = useAppStore()
  const themeClass = useThemeClass()

  // Process tabs to include grouping metadata
  const processedTabs = useMemo(() => {
    return tabs.map((tab) => {
      if (tab.groupTitle) return { ...tab, isAutoGroup: false }
      const conn = connections.find((c) => c.id === tab.connectionId)
      if (conn) {
        return {
          ...tab,
          groupTitle: conn.name,
          groupColor: conn.color || DB_COLORS[conn.type],
          isAutoGroup: true
        }
      }
      return { ...tab, isAutoGroup: false }
    })
  }, [tabs, connections])

  // Group tabs by connection for the top-level row
  const connectionGroups = useMemo(() => {
    const groups: Map<string | 'none', { id: string | null; name: string; color: string; tabs: Array<typeof processedTabs[0]> }> = new Map()
    
    processedTabs.forEach(tab => {
      const connId = tab.connectionId
      const key = connId || 'none'
      if (!groups.has(key)) {
        const conn = connections.find(c => c.id === connId)
        groups.set(key, {
          id: connId,
          name: conn?.name || 'No Connection',
          color: conn ? (conn.color || DB_COLORS[conn.type]) : '#64748b',
          tabs: []
        })
      }
      groups.get(key)!.tabs.push(tab)
    })
    return Array.from(groups.values())
  }, [processedTabs, connections])

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeGroupId = activeTab?.connectionId || (tabs.length > 0 ? 'none' : null)

  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const [pendingCloseSaveName, setPendingCloseSaveName] = useState('')
  const [pendingCloseSaveCategory, setPendingCloseSaveCategory] = useState('')
  const [isSavingBeforeClose, setIsSavingBeforeClose] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [groupEditor, setGroupEditor] = useState<{ tabId: string; value: string } | null>(null)
  const [groupMembersEditor, setGroupMembersEditor] = useState<{
    sourceTabId: string
    selectedTabIds: Set<string>
  } | null>(null)
  const [joinGroupEditor, setJoinGroupEditor] = useState<{ tabId: string; groupTitle: string | null }>({
    tabId: '',
    groupTitle: null
  })
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ tabId: string; side: 'left' | 'right' } | null>(null)

  const pendingCloseTab = useMemo(
    () => tabs.find((t) => t.id === pendingCloseTabId) ?? null,
    [tabs, pendingCloseTabId]
  )

  const availableGroupTitles = useMemo(
    () => Array.from(new Set(tabs.map((t) => t.groupTitle).filter((v): v is string => Boolean(v)))),
    [tabs]
  )

  const isDirtyQueryTab = (tabId: string): boolean => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || tab.tabType !== 'query') return false
    const baseline = tab.lastSavedSql ?? ''
    return tab.sql !== baseline
  }

  const applyTabColor = (tabId: string, color: string | null): void => {
    setTabColor(tabId, color)
    setContextMenu(null)
  }

  const applyGroupColor = (tabId: string, color: string | null): void => {
    const tab = processedTabs.find((t) => t.id === tabId)
    if (!tab?.groupTitle || tab.isAutoGroup) {
      setContextMenu(null)
      return
    }
    for (const groupTab of tabs) {
      if (groupTab.groupTitle === tab.groupTitle) {
        setTabGroup(groupTab.id, groupTab.groupTitle, color)
      }
    }
    setContextMenu(null)
  }

  const editGroupTitle = (tab: QueryTab): void => {
    setGroupEditor({ tabId: tab.id, value: tab.groupTitle ?? '' })
    setContextMenu(null)
  }

  const saveGroupTitle = (): void => {
    if (!groupEditor) return
    const tab = tabs.find((t) => t.id === groupEditor.tabId)
    if (!tab) {
      setGroupEditor(null)
      return
    }
    const nextTitle = groupEditor.value.trim()
    if (!nextTitle) {
      setTabGroup(tab.id, null, null)
      setGroupEditor(null)
      return
    }
    setTabGroup(tab.id, nextTitle, tab.groupColor ?? GROUP_COLORS[0])
    setGroupEditor(null)
  }

  const openGroupMembersEditor = (tab: QueryTab): void => {
    const pTab = processedTabs.find(t => t.id === tab.id)
    if (!pTab?.groupTitle || pTab.isAutoGroup) return
    const selected = new Set(
      tabs
        .filter((t) => t.id !== tab.id && t.groupTitle === pTab.groupTitle)
        .map((t) => t.id)
    )
    setGroupMembersEditor({ sourceTabId: tab.id, selectedTabIds: selected })
    setContextMenu(null)
  }

  const toggleGroupMemberSelection = (tabId: string): void => {
    setGroupMembersEditor((prev) => {
      if (!prev) return prev
      const next = new Set(prev.selectedTabIds)
      if (next.has(tabId)) next.delete(tabId)
      else next.add(tabId)
      return { ...prev, selectedTabIds: next }
    })
  }

  const saveGroupMembers = (): void => {
    if (!groupMembersEditor) return
    const source = tabs.find((t) => t.id === groupMembersEditor.sourceTabId)
    if (!source?.groupTitle) {
      setGroupMembersEditor(null)
      return
    }
    const groupTitle = source.groupTitle
    const groupColor = source.groupColor ?? GROUP_COLORS[0]
    for (const tab of tabs) {
      if (tab.id === source.id) continue
      if (groupMembersEditor.selectedTabIds.has(tab.id)) {
        setTabGroup(tab.id, groupTitle, groupColor)
      } else if (tab.groupTitle === groupTitle) {
        setTabGroup(tab.id, null, null)
      }
    }
    setGroupMembersEditor(null)
  }

  const handleTabDrop = (targetTab: QueryTab, draggedTabId: string, placeAfter: boolean): void => {
    if (targetTab.id === draggedTabId) return
    const draggedTab = processedTabs.find((t) => t.id === draggedTabId)
    if (!draggedTab) return
    
    if (draggedTab.groupTitle && !draggedTab.isAutoGroup) {
      const blockIds = tabs.filter((t) => t.groupTitle === draggedTab.groupTitle).map((t) => t.id)
      const ids = new Set(blockIds)
      if (ids.has(targetTab.id)) return
      const remainingTabs = tabs.filter((t) => !ids.has(t.id))
      const targetIndex = remainingTabs.findIndex((t) => t.id === targetTab.id)
      const toIndex = targetIndex < 0 ? remainingTabs.length : targetIndex + (placeAfter ? 1 : 0)
      moveTabBlock(blockIds, toIndex)
    } else {
      const remainingTabs = tabs.filter((t) => t.id !== draggedTabId)
      const targetIndex = remainingTabs.findIndex((t) => t.id === targetTab.id)
      const toIndex = targetIndex < 0 ? remainingTabs.length : targetIndex + (placeAfter ? 1 : 0)
      moveTab(draggedTabId, toIndex)
    }
  }

  const joinTabToGroup = (tabId: string, groupTitle: string): void => {
    const target = processedTabs.find((t) => t.groupTitle === groupTitle && !t.isAutoGroup)
    if (!target) return
    const targetGroupColor = target.groupColor ?? GROUP_COLORS[0]
    setTabGroup(tabId, groupTitle, targetGroupColor)
    
    const remainingTabs = tabs.filter((t) => t.id !== tabId)
    let lastIndexInGroup = -1
    for (let i = 0; i < remainingTabs.length; i += 1) {
      if (remainingTabs[i].groupTitle === groupTitle) lastIndexInGroup = i
    }
    moveTab(tabId, lastIndexInGroup + 1)
  }

  const ungroupTabs = (groupTitle: string): void => {
    for (const tab of tabs) {
      if (tab.groupTitle === groupTitle) {
        setTabGroup(tab.id, null, null)
      }
    }
  }

  const requestCloseTab = (tabId: string): void => {
    if (!isDirtyQueryTab(tabId)) {
      closeTab(tabId)
      return
    }
    const tab = tabs.find((t) => t.id === tabId)
    setPendingCloseSaveName(tab?.title ?? '')
    setPendingCloseSaveCategory('')
    setPendingCloseTabId(tabId)
  }

  const clearPendingClose = (): void => {
    setPendingCloseTabId(null)
    setPendingCloseSaveName('')
    setPendingCloseSaveCategory('')
  }

  const handleDontSave = (): void => {
    if (!pendingCloseTabId) return
    closeTab(pendingCloseTabId)
    clearPendingClose()
  }

  const handleSaveAndClose = async (): Promise<void> => {
    if (!pendingCloseTab) return
    if (!pendingCloseSaveName.trim()) return
    setIsSavingBeforeClose(true)
    try {
      await saveCurrentQuery(
        pendingCloseTab.id,
        pendingCloseSaveName.trim(),
        pendingCloseSaveCategory.trim() || undefined
      )
      closeTab(pendingCloseTab.id)
      clearPendingClose()
    } finally {
      setIsSavingBeforeClose(false)
    }
  }

  const handleNewTab = (connectionId?: string | null): void => {
    if (connections.length === 0) {
      setStatus('Add a connection before creating query tabs', 'warning')
      return
    }
    newTab(connectionId)
  }

  const handleSelectConnectionGroup = (connId: string | null) => {
    const group = connectionGroups.find(g => g.id === connId)
    if (group && group.tabs.length > 0) {
      // Check if one is already active in this group
      const alreadyActive = group.tabs.find(t => t.id === activeTabId)
      if (!alreadyActive) {
        setActiveTab(group.tabs[0].id)
      }
    }
  }

  if (tabs.length === 0 && connections.length === 0) return null

  return (
    <>
      <div className="tabbar">
        {/* Top Level: Connection Groups */}
        <div className="tabbar-top">
          {connectionGroups.map((group) => (
            <div
              key={group.id || 'none'}
              className={`connection-group-tab ${activeGroupId === (group.id || 'none') ? 'active' : ''}`}
              onClick={() => handleSelectConnectionGroup(group.id)}
            >
              <span className="group-dot" style={{ background: group.color }} />
              {group.name}
              <span style={{ opacity: 0.5, fontSize: '9px', marginLeft: 2 }}>{group.tabs.length}</span>
            </div>
          ))}
          <div
            className="tab-new-btn"
            style={{ width: 22, height: 22, marginLeft: 8 }}
            onClick={() => handleNewTab(activeGroupId === 'none' ? null : (activeGroupId as string))}
            data-tooltip="New Tab in this Connection"
          >
            <Plus size={12} />
          </div>
        </div>

        {/* Bottom Level: Tabs for Active Connection */}
        <div className="tabbar-bottom">
          {processedTabs
            .filter(tab => (tab.connectionId || 'none') === activeGroupId)
            .map((tab) => (
            <div
              key={tab.id}
              className={`tab ${tab.id === activeTabId ? 'active' : ''}${dragOverTabId === tab.id ? ' tab-drop-target' : ''}${
                dropIndicator?.tabId === tab.id && dropIndicator.side === 'left' ? ' tab-insert-left' : ''
              }${dropIndicator?.tabId === tab.id && dropIndicator.side === 'right' ? ' tab-insert-right' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              draggable
              onDragStart={(e) => {
                setDraggingTabId(tab.id)
                e.dataTransfer.setData('text/tab-id', tab.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                setDraggingTabId(null)
                setDragOverTabId(null)
                setDropIndicator(null)
              }}
              onDragOver={(e) => {
                if (draggingTabId === tab.id) return
                e.preventDefault()
                setDragOverTabId(tab.id)
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const side: 'left' | 'right' = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
                setDropIndicator({ tabId: tab.id, side })
              }}
              onDragLeave={() => {
                setDragOverTabId((prev) => (prev === tab.id ? null : prev))
                setDropIndicator((prev) => (prev?.tabId === tab.id ? null : prev))
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverTabId(null)
                setDropIndicator(null)
                const draggedTabId = e.dataTransfer.getData('text/tab-id')
                if (!draggedTabId) return
                const targetRect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const placeAfter = e.clientX > targetRect.left + targetRect.width / 2
                handleTabDrop(tab, draggedTabId, placeAfter)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
              }}
              title={tab.title}
              style={{
                ['--tab-accent' as string]: tab.tabColor ?? tab.groupColor ?? undefined,
                borderTopWidth: tab.tabColor || tab.groupColor ? 2 : undefined,
                borderTopStyle: tab.tabColor || tab.groupColor ? 'solid' : undefined
              }}
            >
              {tab.isRunning ? (
                <span className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />
              ) : (
                <TabIcon tabType={tab.tabType} />
              )}
              <span className="tab-name">
                {!tab.isAutoGroup && tab.groupTitle && (
                  <span
                    className="tab-group-chip"
                    style={{
                      borderColor: `${tab.groupColor ?? '#64748b'}66`,
                      color: tab.groupColor ?? 'var(--text-secondary)'
                    }}
                  >
                    {tab.groupTitle}
                  </span>
                )}
                {isDirtyQueryTab(tab.id) && <span className="tab-dirty-dot" aria-hidden="true" />}
                <span className="tab-title-text">{tab.title || 'Query'}</span>
              </span>
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  requestCloseTab(tab.id)
                }}
              >
                <X size={10} />
              </span>
            </div>
          ))}
          <div
            className={`tab-new-btn${connections.length === 0 ? ' disabled' : ''}`}
            onClick={() => handleNewTab(activeGroupId === 'none' ? null : (activeGroupId as string))}
            data-tooltip="New Query Tab (Ctrl+T)"
          >
            <Plus size={14} />
          </div>
        </div>
      </div>

      {contextMenu && (
        <div className="tab-context-overlay" onClick={() => setContextMenu(null)}>
          <div
            className="tab-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const tab = processedTabs.find((t) => t.id === contextMenu.tabId)
              if (!tab) return null
              const isAuto = tab.isAutoGroup
              return (
                <>
                  <button className="tab-context-item" onClick={() => editGroupTitle(tab)}>
                    {isAuto ? 'Set Custom Group Title...' : 'Edit Group Title...'}
                  </button>
                  {availableGroupTitles.length > 0 && (
                    <button
                      className="tab-context-item"
                      onClick={() => {
                        setJoinGroupEditor({ tabId: tab.id, groupTitle: tab.groupTitle ?? availableGroupTitles[0] })
                        setContextMenu(null)
                      }}
                    >
                      Join Custom Group...
                    </button>
                  )}
                  {tab.groupTitle && !isAuto && (
                    <button className="tab-context-item" onClick={() => ungroupTabs(tab.groupTitle as string)}>
                      Remove from Custom Group
                    </button>
                  )}
                  {tab.groupTitle && !isAuto && (
                    <button className="tab-context-item" onClick={() => openGroupMembersEditor(tab)}>
                      Choose Tabs For Group...
                    </button>
                  )}
                  {tab.groupTitle && !isAuto && (
                    <>
                      <div className="tab-context-label">Group Color</div>
                      <div className="tab-context-colors">
                        {GROUP_COLORS.map((color) => (
                          <button
                            key={`group-${color}`}
                            className="tab-context-color"
                            style={{ background: color }}
                            onClick={() => applyGroupColor(tab.id, color)}
                            title={color}
                          />
                        ))}
                        <button className="tab-context-clear" onClick={() => applyGroupColor(tab.id, null)}>
                          Clear
                        </button>
                      </div>
                    </>
                  )}
                  <div className="tab-context-sep" />
                  <div className="tab-context-label">Tab Color Override</div>
                  <div className="tab-context-colors">
                    {TAB_COLORS.map((color) => (
                      <button
                        key={`tab-${color}`}
                        className="tab-context-color"
                        style={{ background: color }}
                        onClick={() => applyTabColor(tab.id, color)}
                        title={color}
                      />
                    ))}
                    <button className="tab-context-clear" onClick={() => applyTabColor(tab.id, null)}>
                      Clear
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {groupEditor && createPortal(
        <div className={`modal-overlay ${themeClass}`} onClick={() => setGroupEditor(null)}>
          <div className="modal-panel" style={{ width: 380, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Set Group Title</span>
            </div>
            <div className="modal-body">
              <input
                className="form-input"
                type="text"
                value={groupEditor.value}
                onChange={(e) => setGroupEditor((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                placeholder="e.g. Reporting, Debugging, Migration"
                autoFocus
              />
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                Leave empty to remove this tab from a group.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setGroupEditor(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveGroupTitle}>
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {groupMembersEditor && (
        <div className="modal-overlay" onClick={() => setGroupMembersEditor(null)}>
          <div className="modal-panel" style={{ width: 460, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Choose Tabs For Group</span>
            </div>
            <div className="modal-body">
              {tabs
                .filter((t) => t.id !== groupMembersEditor.sourceTabId)
                .map((tab) => (
                  <label key={tab.id} className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={groupMembersEditor.selectedTabIds.has(tab.id)}
                      onChange={() => toggleGroupMemberSelection(tab.id)}
                    />
                    <span className="form-checkbox-label">{tab.title || 'Query'}</span>
                  </label>
                ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setGroupMembersEditor(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveGroupMembers}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {joinGroupEditor.tabId && (
        <div className="modal-overlay" onClick={() => setJoinGroupEditor({ tabId: '', groupTitle: null })}>
          <div className="modal-panel" style={{ width: 380, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Join Group</span>
            </div>
            <div className="modal-body">
              <select
                className="form-select"
                value={joinGroupEditor.groupTitle ?? ''}
                onChange={(e) => setJoinGroupEditor((prev) => ({ ...prev, groupTitle: e.target.value }))}
              >
                {availableGroupTitles.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setJoinGroupEditor({ tabId: '', groupTitle: null })}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (joinGroupEditor.groupTitle) {
                    joinTabToGroup(joinGroupEditor.tabId, joinGroupEditor.groupTitle)
                  }
                  setJoinGroupEditor({ tabId: '', groupTitle: null })
                }}
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingCloseTab && (
        <div className="modal-overlay" onClick={clearPendingClose}>
          <div className="modal-panel" style={{ width: 430, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Save Query</span>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Query Name</label>
                <input
                  className="form-input"
                  type="text"
                  value={pendingCloseSaveName}
                  onChange={(e) => setPendingCloseSaveName(e.target.value)}
                  placeholder="My query…"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveAndClose()
                  }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Category (optional)</label>
                <input
                  className="form-input"
                  type="text"
                  value={pendingCloseSaveCategory}
                  onChange={(e) => setPendingCloseSaveCategory(e.target.value)}
                  placeholder="e.g. Analytics, Reporting…"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={clearPendingClose} disabled={isSavingBeforeClose}>
                Cancel
              </button>
              <button className="btn btn-ghost" onClick={handleDontSave} disabled={isSavingBeforeClose}>
                Don&apos;t Save
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleSaveAndClose()}
                disabled={isSavingBeforeClose || !pendingCloseSaveName.trim()}
              >
                {isSavingBeforeClose ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
