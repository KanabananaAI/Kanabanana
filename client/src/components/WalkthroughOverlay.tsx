import { useCallback, useEffect, useState } from 'react'

export interface WalkthroughStep {
  target: string          // data-tour="<target>" selector
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
  onEnter?: string        // action to trigger when entering this step
  onExit?: string         // action to trigger when leaving this step
}

export const steps: WalkthroughStep[] = [
  {
    target: 'header',
    title: 'Header Bar',
    description: 'Your main navigation. Switch workspaces, create tasks, launch terminals, change themes, and access settings, archive, dependencies, and help from here.',
    position: 'bottom',
  },
  {
    target: 'workspace-selector',
    title: 'Workspace Selector',
    description: 'Organize your work into separate boards. Each workspace has its own set of tasks. Click to switch, create, or delete workspaces.',
    position: 'bottom',
  },
  {
    target: 'new-task-btn',
    title: 'Create New Task',
    description: 'Click to open the task creation modal. Set the title, description, agent type, model, working directory, checklists, and more. You can also apply saved templates.',
    position: 'bottom',
  },
  {
    target: 'workspace-terminal',
    title: 'Workspace Terminal',
    description: 'Launch a workspace-wide agent terminal for ad-hoc commands and brainstorming. Choose an agent type, model, and toggle Yolo mode before starting.',
    position: 'bottom',
  },
  {
    target: 'terminal-panel',
    title: 'Terminal Panel',
    description: 'Displays live agent terminal output. Click the terminal icon on any task card to open it here, or drag a task onto an empty slot. Each slot shows real-time input/output — you can type commands directly to interact with running agents.',
    position: 'left',
    onEnter: 'open-terminal',
  },
  {
    target: 'terminal-split-btn',
    title: 'Split Terminals',
    description: 'Click the split button to add more terminal slots side-by-side. Cycles through 1 → 2 → 3 → 4 → 5 → 6 slots, then back to 1. Monitor multiple agents at once. Close individual slots with the × button — the agent keeps running.',
    position: 'left',
    onEnter: 'split-terminal',
    onExit: 'close-terminal',
  },
  {
    target: 'col-backlog',
    title: 'Backlog Column',
    description: 'Park ideas and future work here. Tasks in Backlog are not actively being worked on. Drag tasks out when ready.',
    position: 'right',
  },
  {
    target: 'col-todo',
    title: 'To Do Column',
    description: 'Planned tasks ready to be picked up. Move a task here when it\'s ready for an agent, then spawn it to start work.',
    position: 'right',
  },
  {
    target: 'col-scheduled',
    title: 'Scheduled Column',
    description: 'Tasks with time-based schedules appear here. They auto-spawn when their scheduled time arrives. Set one-time or recurring schedules via the task context menu.',
    position: 'right',
  },
  {
    target: 'col-in-progress',
    title: 'In Progress Column',
    description: 'Active agent execution. Tasks here have a running agent working on them. You can send feedback (with voice dictation), pause, kill, or run skills on the agent in real-time.',
    position: 'right',
  },
  {
    target: 'col-review',
    title: 'Review Column',
    description: 'Agent finished — your turn! Review the agent\'s work, provide feedback, or approve. Enable Auto-Review on a task to skip this step.',
    position: 'left',
  },
  {
    target: 'col-inspect',
    title: 'Inspect Column',
    description: 'AI auto-verification mode. Another agent reviews the work for quality using the verify agent/model configured in Settings. Enable Auto-Complete to finish automatically.',
    position: 'left',
  },
  {
    target: 'col-done',
    title: 'Done Column',
    description: 'Completed tasks land here, sorted by completion time. You can archive old tasks to keep your board clean.',
    position: 'left',
  },
  {
    target: 'theme-btn',
    title: 'Theme Switcher',
    description: 'Cycle through 5 visual themes: Dark, Experimental, Banana Dark, Banana Light, and Light. Click to switch instantly.',
    position: 'bottom',
  },
  {
    target: 'settings-btn',
    title: 'Settings Panel',
    description: 'Configure everything across 7 tabs: Appearance, Models, Verification, Sound, Tags, Templates, and GitHub integration.',
    position: 'bottom',
  },
  {
    target: 'restart-btn',
    title: 'Restart Server',
    description: 'Restart the Kanabanana server. Active agents will be killed. The server reconnects automatically after ~20 seconds.',
    position: 'bottom',
  },
  {
    target: 'archive-btn',
    title: 'Archive',
    description: 'View and restore archived tasks. Archive completed tasks to declutter your board without losing them.',
    position: 'bottom',
  },
  {
    target: 'deps-btn',
    title: 'Dependency Graph',
    description: 'Visualize how tasks depend on each other. Great for understanding complex workflows and sequencing. Set dependencies when creating or editing tasks.',
    position: 'bottom',
  },
  {
    target: 'orchestrator-panel',
    title: 'Orchestrator Panel',
    description: 'The AI orchestrator manages task flow automatically — sequencing work, coordinating agents, detecting ghost tasks, and logging decisions. Check the Activity, Agents, and Systems tabs.',
    position: 'left',
  },
  {
    target: 'agent-panel',
    title: 'Agent Chat Panel',
    description: 'Start a live chat session with any agent (Claude, Gemini, Kilo, Droid, LM Studio). This is separate from task execution — use it for quick questions, brainstorming, or ad-hoc commands.',
    position: 'left',
  },
  {
    target: 'help-btn',
    title: 'You Found Help!',
    description: 'Click the ? icon anytime to open the full reference guide. You can also restart this walkthrough from the Help panel.',
    position: 'bottom',
  },
]

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  // Scroll into view if off-screen
  const r = el.getBoundingClientRect()
  if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    const r2 = el.getBoundingClientRect()
    return { top: r2.top, left: r2.left, width: r2.width, height: r2.height }
  }
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

interface WalkthroughOverlayProps {
  onClose: () => void
  onAction?: (action: string) => void
}

export default function WalkthroughOverlay({ onClose, onAction }: WalkthroughOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const step = steps[stepIndex]

  const goToStep = useCallback((newIndex: number) => {
    const current = steps[stepIndex]
    const next = steps[newIndex]
    if (current?.onExit && onAction) onAction(current.onExit)
    if (next?.onEnter && onAction) onAction(next.onEnter)
    setStepIndex(newIndex)
  }, [stepIndex, onAction])

  const handleClose = useCallback(() => {
    const current = steps[stepIndex]
    if (current?.onExit && onAction) onAction(current.onExit)
    onClose()
  }, [stepIndex, onAction, onClose])

  const measureNow = useCallback(() => {
    if (!step) return
    const r = getTargetRect(step.target)
    setRect(r)
  }, [step])

  useEffect(() => {
    // Immediate measure for most steps
    requestAnimationFrame(measureNow)
    // Delayed re-measure so steps that mount new components (e.g. terminal panel)
    // have time to render into the DOM before we spotlight them
    const timer = step?.onEnter ? setTimeout(measureNow, 200) : undefined
    window.addEventListener('resize', measureNow)
    window.addEventListener('scroll', measureNow, true)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', measureNow)
      window.removeEventListener('scroll', measureNow, true)
    }
  }, [measureNow, step])

  const handleNext = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      goToStep(stepIndex + 1)
    } else {
      handleClose()
    }
  }, [stepIndex, goToStep, handleClose])

  const handlePrev = useCallback(() => {
    if (stepIndex > 0) {
      goToStep(stepIndex - 1)
    }
  }, [stepIndex, goToStep])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext()
      if (e.key === 'ArrowLeft') handlePrev()
    },
    [handleClose, handleNext, handlePrev]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!step) return null

  const pad = 8 // spotlight padding around element

  // Tooltip always centered on screen — only the spotlight moves
  const tooltipStyle: React.CSSProperties = {
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dark overlay with spotlight cutout using CSS clip-path */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - pad}
                y={rect.top - pad}
                width={rect.width + pad * 2}
                height={rect.height + pad * 2}
                rx="8"
                ry="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          fill="rgba(0,0,0,0.7)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight ring highlight */}
      {rect && (
        <div
          className="absolute border-2 border-yellow-400 rounded-lg pointer-events-none"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 4px rgba(250, 204, 21, 0.2), 0 0 20px rgba(250, 204, 21, 0.15)',
            transition: 'all 0.3s ease-in-out',
          }}
        />
      )}

      {/* Clickable backdrop to dismiss */}
      <div className="absolute inset-0" onClick={handleClose} style={{ pointerEvents: 'auto' }} />

      {/* Tooltip card */}
      <div
        className="absolute bg-board-card border border-yellow-400/40 rounded-xl shadow-2xl p-4 w-[340px]"
        style={{
          ...tooltipStyle,
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step counter */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-text-primary transition-colors"
            title="Exit tour (Esc)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <h3 className="text-sm font-bold text-text-primary mb-1.5">{step.title}</h3>

        {/* Description */}
        <p className="text-xs text-text-secondary leading-relaxed mb-4">{step.description}</p>

        {/* Progress dots */}
        <div className="flex items-center gap-1 mb-3">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => goToStep(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? 'bg-yellow-400 w-4'
                  : i < stepIndex
                    ? 'bg-yellow-400/40'
                    : 'bg-board-border'
              }`}
              title={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={stepIndex === 0}
            className="text-xs px-3 py-1.5 rounded border border-board-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              className="text-xs px-3 py-1.5 text-text-muted hover:text-text-primary transition-colors"
            >
              Skip tour
            </button>
            <button
              onClick={handleNext}
              className="text-xs px-4 py-1.5 rounded bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition-colors"
            >
              {stepIndex === steps.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] text-text-muted mt-2 text-center">
          Use arrow keys to navigate &middot; Esc to exit
        </p>
      </div>
    </div>
  )
}
