import { useMemo } from 'react'
import type { Task } from '../types'

interface DependencyGraphProps {
  tasks: Task[]
  isOpen: boolean
  onClose: () => void
}

const statusColors: Record<string, string> = {
  idle: '#6b7280',
  thinking: '#eab308',
  executing: '#22c55e',
  'waiting-for-input': '#eab308',
  error: '#ef4444',
  done: '#3b82f6',
}

interface NodePosition {
  x: number
  y: number
  task: Task
}

export default function DependencyGraph({
  tasks,
  isOpen,
  onClose,
}: DependencyGraphProps) {
  const { nodes, edges, width, height } = useMemo(() => {
    // Only include tasks that have dependencies or are depended upon
    const relevantIds = new Set<string>()
    for (const task of tasks) {
      if (task.dependsOn.length > 0) {
        relevantIds.add(task.id)
        for (const depId of task.dependsOn) {
          relevantIds.add(depId)
        }
      }
    }

    const relevantTasks = tasks.filter((t) => relevantIds.has(t.id))

    if (relevantTasks.length === 0) {
      return { nodes: [], edges: [], width: 400, height: 200 }
    }

    // Simple layout: arrange in columns by column position
    const columnOrder = ['backlog', 'todo', 'scheduled', 'in-progress', 'review', 'inspect', 'done']
    const nodeWidth = 160
    const nodeHeight = 40
    const colGap = 200
    const rowGap = 60
    const padX = 30
    const padY = 30

    const byColumn: Record<string, Task[]> = {}
    for (const t of relevantTasks) {
      if (!byColumn[t.column]) byColumn[t.column] = []
      byColumn[t.column].push(t)
    }

    const positions: NodePosition[] = []
    let maxX = 0
    let maxY = 0

    for (const col of columnOrder) {
      const colTasks = byColumn[col] || []
      const colIndex = columnOrder.indexOf(col)
      colTasks.forEach((task, rowIndex) => {
        const x = padX + colIndex * colGap
        const y = padY + rowIndex * rowGap
        positions.push({ x, y, task })
        maxX = Math.max(maxX, x + nodeWidth)
        maxY = Math.max(maxY, y + nodeHeight)
      })
    }

    const posMap = new Map<string, NodePosition>()
    for (const pos of positions) {
      posMap.set(pos.task.id, pos)
    }

    const edgeList: { from: NodePosition; to: NodePosition }[] = []
    for (const task of relevantTasks) {
      const toPos = posMap.get(task.id)
      if (!toPos) continue
      for (const depId of task.dependsOn) {
        const fromPos = posMap.get(depId)
        if (fromPos) {
          edgeList.push({ from: fromPos, to: toPos })
        }
      }
    }

    return {
      nodes: positions,
      edges: edgeList,
      width: maxX + padX,
      height: maxY + padY,
    }
  }, [tasks])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-w-4xl max-h-[80vh] overflow-auto bg-board-card border border-board-border rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Dependency Graph
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary text-lg"
          >
            x
          </button>
        </div>

        {nodes.length === 0 ? (
          <p className="text-text-secondary text-sm">
            No task dependencies to display.
          </p>
        ) : (
          <svg
            width={width}
            height={height}
            className="block"
            style={{ minWidth: width, minHeight: height }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#4b5563" />
              </marker>
            </defs>

            {/* Edges */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + 160
              const y1 = edge.from.y + 20
              const x2 = edge.to.x
              const y2 = edge.to.y + 20
              const midX = (x1 + x2) / 2
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  stroke="#4b5563"
                  strokeWidth="1.5"
                  fill="none"
                  markerEnd="url(#arrowhead)"
                />
              )
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const color = statusColors[node.task.status] || '#6b7280'
              return (
                <g key={node.task.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={160}
                    height={40}
                    rx={4}
                    fill="#1a1a1a"
                    stroke="#2a2a2a"
                    strokeWidth="1"
                  />
                  {/* Status dot */}
                  <circle
                    cx={node.x + 14}
                    cy={node.y + 20}
                    r={4}
                    fill={color}
                  />
                  {/* Title text */}
                  <text
                    x={node.x + 26}
                    y={node.y + 16}
                    fill="#e5e5e5"
                    fontSize="11"
                    fontFamily="sans-serif"
                  >
                    {node.task.title.length > 16
                      ? node.task.title.slice(0, 16) + '...'
                      : node.task.title}
                  </text>
                  {/* Column label */}
                  <text
                    x={node.x + 26}
                    y={node.y + 30}
                    fill="#6b7280"
                    fontSize="9"
                    fontFamily="sans-serif"
                  >
                    {node.task.column}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}
