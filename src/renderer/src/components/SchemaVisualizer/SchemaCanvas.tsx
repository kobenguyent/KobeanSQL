import React, { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TableNode, { type TableNodeData } from './TableNode'
import type { DatabaseSchema, SchemaViewMode } from '@renderer/types/schema'

const NODE_WIDTH = 260
const BASE_HEIGHT = 48
const ROW_HEIGHT = 28
const COLLAPSED_THRESHOLD = 30
const nodeTypes: NodeTypes = { tableNode: TableNode as any }

function estimateNodeHeight(columnCount: number, collapsed: boolean): number {
  return collapsed ? BASE_HEIGHT : BASE_HEIGHT + columnCount * ROW_HEIGHT
}

function runSimpleLayout(nodes: Node[]): Node[] {
  const count = nodes.length
  const cols = Math.ceil(Math.sqrt(count))
  const spacingX = 350, spacingY = 250
  return nodes.map((n, i) => ({
    ...n,
    position: { x: (i % cols) * spacingX, y: Math.floor(i / cols) * spacingY }
  }))
}

interface CanvasInnerProps {
  schema: DatabaseSchema
  mode: SchemaViewMode
  selectedTableId?: string
}

function CanvasInner({ schema, mode, selectedTableId }: CanvasInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const buildGraph = useCallback(() => {
    const isGlobal = mode === 'GLOBAL_MODE'
    const shouldCollapse = isGlobal && schema.tables.length > COLLAPSED_THRESHOLD
    let visibleTables = schema.tables, visibleEdges = schema.relationships

    if (mode === 'FOCUSED_MODE' && selectedTableId) {
      const related = new Set([selectedTableId])
      schema.relationships.forEach(r => {
        if (r.sourceTable === selectedTableId) related.add(r.targetTable)
        if (r.targetTable === selectedTableId) related.add(r.sourceTable)
      })
      visibleTables = schema.tables.filter(t => related.has(t.id))
      visibleEdges = schema.relationships.filter(r => related.has(r.sourceTable) && related.has(r.targetTable))
    }

    const rawNodes: Node[] = visibleTables.map(table => ({
      id: table.id,
      type: 'tableNode',
      position: { x: 0, y: 0 },
      data: { table, collapsed: shouldCollapse && table.id !== selectedTableId }
    }))

    const rawEdges: Edge[] = visibleEdges.map(rel => ({
      id: rel.id, source: rel.sourceTable, target: rel.targetTable,
      sourceHandle: `${rel.sourceTable}.${rel.sourceColumn}`,
      targetHandle: `${rel.targetTable}.${rel.targetColumn}`,
      type: 'smoothstep', animated: false,
      style: { stroke: 'var(--schema-edge-color, #7b7bea)', strokeWidth: 1.5 }
    }))

    setNodes(runSimpleLayout(rawNodes))
    setEdges(rawEdges)
  }, [schema, mode, selectedTableId, setNodes, setEdges])

  useEffect(() => { buildGraph() }, [buildGraph])

  return (
    <ReactFlow
      nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }}
      minZoom={0.05} maxZoom={2} proOptions={{ hideAttribution: true }}
      className="schema-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="schema-bg" />
      <Controls className="schema-controls" />
      <MiniMap nodeColor={() => 'var(--schema-minimap-node, #7b7bea44)'} maskColor="var(--schema-minimap-mask, rgba(8,8,15,0.7))" className="schema-minimap" />
    </ReactFlow>
  )
}

export function SchemaCanvas({ schema, mode = 'GLOBAL_MODE', selectedTableId }: { schema: DatabaseSchema, mode?: SchemaViewMode, selectedTableId?: string }) {
  return <ReactFlowProvider><CanvasInner schema={schema} mode={mode} selectedTableId={selectedTableId} /></ReactFlowProvider>
}
