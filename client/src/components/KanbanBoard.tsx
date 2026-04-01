import { useCallback } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import type { Task, ColumnId } from '../types'
import { useSocket } from '../hooks/useSocket'
import TaskCard from './TaskCard'
import { columnIcons } from './BananaIcons'

interface KanbanBoardProps {
  tasks: Task[]
  onTaskUpdate: (task: Task) => void
  onOpenCreateModal: (column: ColumnId) => void
  onCardClick: (task: Task) => void
  onDeleteTask: (task: Task) => void
  onArchiveTask?: (task: Task) => void
  onEditTaskSettings?: (task: Task) => void
  onScheduleTask?: (task: Task) => void
  canCreateTasks?: boolean
  reviewDoneCardStyle?: 'expanded' | 'collapsed'
}

interface ColumnConfig {
  id: ColumnId
  title: string
  canCreate: boolean
}

const columns: ColumnConfig[] = [
  { id: 'backlog', title: 'Backlog', canCreate: true },
  { id: 'todo', title: 'To Do', canCreate: true },
  { id: 'scheduled', title: 'Scheduled', canCreate: false },
  { id: 'in-progress', title: 'In Progress', canCreate: false },
  { id: 'review', title: 'Review', canCreate: false },
  { id: 'inspect', title: 'Inspect', canCreate: false },
  { id: 'done', title: 'Completed', canCreate: false },
]

export default function KanbanBoard({
  tasks,
  onTaskUpdate,
  onOpenCreateModal,
  onCardClick,
  onDeleteTask,
  onArchiveTask,
  onEditTaskSettings,
  onScheduleTask,
  canCreateTasks = true,
  reviewDoneCardStyle = 'expanded',
}: KanbanBoardProps) {
  const socket = useSocket()

  const getColumnTasks = useCallback(
    (columnId: ColumnId): Task[] => {
      const filtered = tasks.filter((t) => t.column === columnId && !t.archived)
      if (columnId === 'done') {
        // Done column: newest completed first
        return filtered.sort((a, b) => {
          const aTime = a.completedAt || a.updatedAt
          const bTime = b.completedAt || b.updatedAt
          return new Date(bTime).getTime() - new Date(aTime).getTime()
        })
      }
      // All other columns: newest created first (chronological, newest on top)
      return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    },
    [tasks]
  )

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { destination, source, draggableId } = result

      if (!destination) return
      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      ) {
        return
      }

      const task = tasks.find((t) => t.id === draggableId)
      if (!task) return

      const fromColumn = source.droppableId as ColumnId
      const toColumn = destination.droppableId as ColumnId
      const newPosition = destination.index

      console.log(`%c[kanaban:board] Drag — "${task.title}" ${fromColumn} → ${toColumn} (pos=${newPosition})`, 'color:#facc15')

      // Optimistic update
      const updatedTask: Task = {
        ...task,
        column: toColumn,
        position: newPosition,
      }
      onTaskUpdate(updatedTask)

      // Persist
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ column: toColumn, position: newPosition }),
        })
        console.log(`%c[kanaban:board] Move persisted — HTTP ${res.status}`, 'color:#facc15')
      } catch (err) {
        console.error('[kanaban:board] Move failed, reverting:', err)
        onTaskUpdate(task)
        return
      }

      // If dropped into in-progress, spawn the agent (unless waitlisted)
      if (toColumn === 'in-progress' && fromColumn !== 'in-progress') {
        if (task.waitlisted) {
          console.log(`%c[kanaban:board] Waitlisted task "${task.title}" moved to in-progress — queued`, 'color:#f59e0b;font-weight:bold')
          socket.emit('waitlist:check')
        } else {
          console.log(`%c[kanaban:board] Spawning agent for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#22c55e;font-weight:bold')
          socket.emit('task:spawn', { taskId: task.id })
        }
      }

      // If dropped into inspect, trigger verification
      if (toColumn === 'inspect' && fromColumn !== 'inspect') {
        console.log(`%c[kanaban:board] Triggering inspection for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#3b82f6;font-weight:bold')
        socket.emit('task:verify', { taskId: task.id })
      }

      // If dragged OUT of in-progress, kill the agent (but NOT when moving to review or inspect)
      if (fromColumn === 'in-progress' && toColumn !== 'in-progress' && toColumn !== 'review' && toColumn !== 'inspect') {
        console.log(`%c[kanaban:board] Killing agent for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#ef4444;font-weight:bold')
        socket.emit('task:kill', { taskId: task.id })
      }

      // If dragged OUT of review to done (or any other column besides inspect/in-progress), kill the agent
      if (fromColumn === 'review' && toColumn !== 'review' && toColumn !== 'in-progress' && toColumn !== 'inspect') {
        console.log(`%c[kanaban:board] Killing agent (leaving review) for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#ef4444;font-weight:bold')
        socket.emit('task:kill', { taskId: task.id })
      }

      // If dragged OUT of inspect, kill the verification agent
      if (fromColumn === 'inspect' && toColumn !== 'inspect') {
        console.log(`%c[kanaban:board] Killing inspection agent for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#ef4444;font-weight:bold')
        socket.emit('task:kill', { taskId: task.id })
      }
    },
    [tasks, onTaskUpdate, socket]
  )

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-3 h-full overflow-x-auto px-4 pb-4">
        {columns.map((col) => {
          const columnTasks = getColumnTasks(col.id)
          return (
            <div
              key={col.id}
              data-tour={`col-${col.id}`}
              className="flex-1 min-w-[260px] max-w-[380px] flex flex-col min-h-0"
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-2 py-2 mb-2 sticky top-0 z-10 bg-board-bg shrink-0">
                <div className="flex items-center gap-2">
                  {columnIcons[col.id] && columnIcons[col.id]({ size: 14, className: 'shrink-0' })}
                  <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    {col.title}
                  </h2>
                  <span className="text-[10px] text-text-muted bg-board-bg border border-board-border rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                    {columnTasks.length}
                  </span>
                </div>
                {col.canCreate && (
                  <button
                    onClick={() => onOpenCreateModal(col.id)}
                    disabled={!canCreateTasks}
                    className={`text-sm px-1 ${canCreateTasks
                        ? 'text-text-muted hover:text-text-secondary'
                        : 'text-text-muted cursor-not-allowed opacity-50'
                      }`}
                    title={canCreateTasks ? `Add task to ${col.title}` : 'Select a workspace first'}
                  >
                    +
                  </button>
                )}
              </div>

              {/* Droppable area */}
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 rounded p-1 transition-colors ${snapshot.isDraggingOver
                        ? 'bg-board-surface border border-dashed border-board-border'
                        : 'border border-transparent'
                      }`}
                  >
                    {columnTasks.map((task, index) => (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={index}
                      >
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={`transition-shadow ${dragSnapshot.isDragging
                                ? 'shadow-lg shadow-black/30'
                                : ''
                              }`}
                          >
                            <TaskCard
                              task={task}
                              onUpdate={onTaskUpdate}
                              onCardClick={onCardClick}
                              onDelete={onDeleteTask}
                              onArchive={onArchiveTask}
                              onEditSettings={onEditTaskSettings}
                              onScheduleTask={onScheduleTask}
                              reviewDoneCardStyle={reviewDoneCardStyle}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )
}
