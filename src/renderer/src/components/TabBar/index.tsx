import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, Table, Code2, FunctionSquare, ChevronsDown, ChevronsUp, Database } from 'lucide-react'
import { useAppStore } from '../../store'
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

  // Process tabs to include automatic grouping by connection
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
  const [dragOverGroupTitle, setDragOverGroupTitle] = useState<string | null>(null)
  const [dropPulseTabId, setDropPulseTabId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [dropIndicator, setDropIndicator] = useState<{ tabId: string; side: 'left' | 'right' } | null>(null)

  const pendingCloseTab = useMemo(
    () => tabs.find((t) => t.id === pendingCloseTabId) ?? null,
    [tabs, pendingCloseTabId]
  )
  const groupShapeByTabId = useMemo(() => {
    const map: Record<string, 'single' | 'start' | 'middle' | 'end'> = {}
    for (let i = 0; i < processedTabs.length; i += 1) {
      const tab = processedTabs[i]
      if (!tab.groupTitle) {
        map[tab.id] = 'single'
        continue
      }
      const prev = processedTabs[i - 1]
      const next = processedTabs[i + 1]
      const samePrev = prev?.groupTitle === tab.groupTitle
      const sameNext = next?.groupTitle === tab.groupTitle
      if (!samePrev && !sameNext) map[tab.id] = 'single'
      else if (!samePrev && sameNext) map[tab.id] = 'start'
      else if (samePrev && sameNext) map[tab.id] = 'middle'
      else map[tab.id] = 'end'
    }
    return map
  }, [processedTabs])
  const availableGroupTitles = useMemo(
    () => Array.from(new Set(tabs.map((t) => t.groupTitle).filter((v): v is string => Boolean(v)))),
    [tabs]
  )
  const visibleTabs = useMemo(() => {
    const firstByGroup = new Map<string, string>()
    for (const tab of processedTabs) {
      if (!tab.groupTitle) continue
      if (!firstByGroup.has(tab.groupTitle)) firstByGroup.set(tab.groupTitle, tab.id)
    }
    return processedTabs.filter((tab) => {
      if (!tab.groupTitle) return true
      if (!collapsedGroups.has(tab.groupTitle!)) return true
      return firstByGroup.get(tab.groupTitle) === tab.id
    })
  }, [processedTabs, collapsedGroups])

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

  const getInsertIndexAroundTarget = (draggedTabId: string, targetTabId: string, placeAfter: boolean): number => {
    const remainingTabs = tabs.filter((t) => t.id !== draggedTabId)
    const targetIndex = remainingTabs.findIndex((t) => t.id === targetTabId)
    if (targetIndex < 0) return remainingTabs.length
    return targetIndex + (placeAfter ? 1 : 0)
  }

  const getInsertIndexAroundTargetForBlock = (draggedIds: Set<string>, targetTabId: string, placeAfter: boolean): number => {
    const remainingTabs = tabs.filter((t) => !draggedIds.has(t.id))
    const targetIndex = remainingTabs.findIndex((t) => t.id === targetTabId)
    if (targetIndex < 0) return remainingTabs.length
    return targetIndex + (placeAfter ? 1 : 0)
  }

  const handleTabDrop = (targetTab: QueryTab, draggedTabId: string, placeAfter: boolean): void => {
    if (targetTab.id === draggedTabId) return
    const draggedTab = processedTabs.find((t) => t.id === draggedTabId)
    if (!draggedTab) return
    // Reorder only. Do not auto-change group metadata on drop.
    if (draggedTab.groupTitle && !draggedTab.isAutoGroup) {
      const blockIds = tabs.filter((t) => t.groupTitle === draggedTab.groupTitle).map((t) => t.id)
      const ids = new Set(blockIds)
      if (ids.has(targetTab.id)) return
      const toIndex = getInsertIndexAroundTargetForBlock(ids, targetTab.id, placeAfter)
      moveTabBlock(blockIds, toIndex)
    } else {
      const toIndex = getInsertIndexAroundTarget(draggedTabId, targetTab.id, placeAfter)
      moveTab(draggedTabId, toIndex)
    }

    setDropPulseTabId(targetTab.id)
    setTimeout(() => setDropPulseTabId((prev) => (prev === targetTab.id ? null : prev)), 420)
  }

  const handleDropToGroupChip = (targetTab: QueryTab, draggedTabId: string): void => {
    const pTarget = processedTabs.find(t => t.id === targetTab.id)
    if (!pTarget?.groupTitle || targetTab.id === draggedTabId || pTarget.isAutoGroup) return
    const targetGroupColor = targetTab.groupColor ?? GROUP_COLORS[0]
    setTabGroup(draggedTabId, pTarget.groupTitle, targetGroupColor)
    const remainingTabs = tabs.filter((t) => t.id !== draggedTabId)
    let insertIndex = remainingTabs.findIndex((t) => t.id === targetTab.id)
    for (let i = 0; i < remainingTabs.length; i += 1) {
      if (remainingTabs[i].groupTitle === pTarget.groupTitle) {
        insertIndex = i
      }
    }
    moveTab(draggedTabId, insertIndex + 1)
    setDropPulseTabId(targetTab.id)
    setTimeout(() => setDropPulseTabId((prev) => (prev === targetTab.id ? null : prev)), 420)
  }

  const joinTabToGroup = (tabId: string, groupTitle: string): void => {
    const target = processedTabs.find((t) => t.groupTitle === groupTitle && !t.isAutoGroup)
    if (!target) return
    handleDropToGroupChip(target, tabId)
  }

  const ungroupTabs = (groupTitle: string): void => {
    for (const tab of tabs) {
      if (tab.groupTitle === groupTitle) {
        setTabGroup(tab.id, null, null)
      }
    }
  }

  const toggleGroupCollapsed = (groupTitle: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupTitle)) next.delete(groupTitle)
      else next.add(groupTitle)
      return next
    })
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

  const handleNewTab = (): void => {
    if (connections.length === 0) {
      setStatus('Add a connection before creating query tabs', 'warning')
      return
    }
    newTab()
  }

  return (
    <>
      <div className="tabbar">
        {visibleTabs.map((tab) => (
          (() => {
            const isCollapsedGroupLeader = Boolean(tab.groupTitle && collapsedGroups.has(tab.groupTitle!))
            return (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}${dragOverTabId === tab.id ? ' tab-drop-target' : ''}${
              dropPulseTabId === tab.id ? ' tab-drop-pulse' : ''
            } ${tab.groupTitle ? `tab-grouped tab-group-${groupShapeByTabId[tab.id] ?? 'single'}` : ''}${
              dragOverGroupTitle && tab.groupTitle === dragOverGroupTitle ? ' tab-group-drop-target' : ''
            }${isCollapsedGroupLeader ? ' tab-group-minimized' : ''}${dropIndicator?.tabId === tab.id && dropIndicator.side === 'left' ? ' tab-insert-left' : ''}${
              dropIndicator?.tabId === tab.id && dropIndicator.side === 'right' ? ' tab-insert-right' : ''
            }${tab.isAutoGroup ? ' tab-auto-grouped' : ''}`}
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
              setDragOverGroupTitle(null)
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
              setDragOverGroupTitle(null)
              setDropIndicator(null)
              const draggedTabId = e.dataTransfer.getData('text/tab-id')
              if (!draggedTabId) return
              // Best-practice behavior: when dropping near the group chip area on grouped tabs,
              // treat it as an explicit "join this group" action.
              if (tab.groupTitle && !tab.isAutoGroup) {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const offsetX = e.clientX - rect.left
                if (offsetX <= 120) {
                  handleDropToGroupChip(tab, draggedTabId)
                  return
                }
              }
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
              ['--tab-group-conn' as string]: tab.groupColor ?? undefined,
              borderTopWidth: tab.tabColor || tab.groupColor ? 2 : undefined,
              borderTopStyle: tab.tabColor || tab.groupColor ? 'solid' : undefined
            }}
          >
            {isCollapsedGroupLeader ? (
              <span
                className={`tab-group-chip tab-group-chip-minimized ${tab.isAutoGroup ? 'tab-group-chip-auto' : ''}`}
                style={{
                  borderColor: `${tab.groupColor ?? '#64748b'}66`,
                  color: tab.groupColor ?? 'var(--text-secondary)'
                }}
                title={tab.groupTitle}
              >
                {tab.isAutoGroup ? <Database size={10} style={{ marginRight: 4, opacity: 0.8 }} /> : <span className="tab-group-chip-dot" style={{ background: tab.groupColor ?? '#64748b' }} />}
                <button
                  className="tab-group-collapse-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGroupCollapsed(tab.groupTitle as string)
                  }}
                  title={collapsedGroups.has(tab.groupTitle!) ? 'Expand group' : 'Minimize group'}
                >
                  {collapsedGroups.has(tab.groupTitle!) ? <ChevronsDown size={10} /> : <ChevronsUp size={10} />}
                </button>
                <span
                  className="tab-group-chip-text"
                  onDragOver={(e) => {
                    if (!tab.groupTitle || tab.isAutoGroup || draggingTabId === tab.id) return
                    e.preventDefault()
                    setDragOverGroupTitle(tab.groupTitle)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOverGroupTitle(null)
                    const draggedTabId = e.dataTransfer.getData('text/tab-id')
                    if (draggedTabId) handleDropToGroupChip(tab, draggedTabId)
                  }}
                >
                  {tab.groupTitle}
                </span>
              </span>
            ) : (
              <>
                {tab.isRunning ? (
                  <span className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />
                ) : (
                  <TabIcon tabType={tab.tabType} />
                )}
                <span className="tab-name">
                  {tab.groupTitle && (groupShapeByTabId[tab.id] === 'start' || groupShapeByTabId[tab.id] === 'single') && (
                    <span
                      className={`tab-group-chip ${tab.isAutoGroup ? 'tab-group-chip-auto' : ''}`}
                      style={{
                        borderColor: `${tab.groupColor ?? '#64748b'}66`,
                        color: tab.groupColor ?? 'var(--text-secondary)'
                      }}
                      title={tab.groupTitle}
                    >
                      {tab.isAutoGroup ? <Database size={10} style={{ marginRight: 4, opacity: 0.8 }} /> : <span className="tab-group-chip-dot" style={{ background: tab.groupColor ?? '#64748b' }} />}
                      <button
                        className="tab-group-collapse-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleGroupCollapsed(tab.groupTitle as string)
                        }}
                        title={collapsedGroups.has(tab.groupTitle!) ? 'Expand group' : 'Minimize group'}
                      >
                        {collapsedGroups.has(tab.groupTitle!) ? <ChevronsDown size={10} /> : <ChevronsUp size={10} />}
                      </button>
                      <span
                        className="tab-group-chip-text"
                        onDragOver={(e) => {
                          if (!tab.groupTitle || tab.isAutoGroup || draggingTabId === tab.id) return
                          e.preventDefault()
                          setDragOverGroupTitle(tab.groupTitle)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverGroupTitle(null)
                          const draggedTabId = e.dataTransfer.getData('text/tab-id')
                          if (draggedTabId) handleDropToGroupChip(tab, draggedTabId)
                        }}
                      >
                        {tab.groupTitle}
                      </span>
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
              </>
            )}
          </div>
            )
          })()
        ))}
        <div
          className={`tab-new-btn${connections.length === 0 ? ' disabled' : ''}`}
          onClick={handleNewTab}
          data-tooltip={connections.length === 0 ? undefined : 'New Query Tab (Ctrl+T)'}
          title={connections.length === 0 ? 'Add a connection first' : 'New Query Tab (Ctrl+T)'}
        >
          <Plus size={14} />
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
                  {tab.groupTitle && (
                    <button className="tab-context-item" onClick={() => toggleGroupCollapsed(tab.groupTitle as string)}>
                      {collapsedGroups.has(tab.groupTitle!) ? 'Expand Group' : 'Minimize Group'}
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
...
        <div className="modal-overlay" onClick={() => setGroupEditor(null)}>
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
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                Tip: You can also drag a tab onto a grouped tab to join that group.
              </div>
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
