import { useEffect, useState } from 'react'
import type { Toast } from '../hooks/useNotifications'

interface NotificationToastProps {
  toast: Toast
  onDismiss: (id: string) => void
}

const typeConfig: Record<
  string,
  { border: string; icon: string; iconColor: string }
> = {
  'agent-started': {
    border: 'border-l-blue-500',
    icon: '>>',
    iconColor: 'text-blue-400',
  },
  'status-change': {
    border: 'border-l-yellow-500',
    icon: '~',
    iconColor: 'text-yellow-400',
  },
  'needs-input': {
    border: 'border-l-yellow-500',
    icon: '?',
    iconColor: 'text-yellow-400',
  },
  completed: {
    border: 'border-l-green-500',
    icon: '*',
    iconColor: 'text-green-400',
  },
  error: {
    border: 'border-l-red-500',
    icon: '!',
    iconColor: 'text-red-400',
  },
  'chain-triggered': {
    border: 'border-l-blue-500',
    icon: '->',
    iconColor: 'text-blue-400',
  },
}

export default function NotificationToast({
  toast,
  onDismiss,
}: NotificationToastProps) {
  const [visible, setVisible] = useState(false)
  const config = typeConfig[toast.type] ?? typeConfig['status-change']

  useEffect(() => {
    // Trigger slide-in animation
    const timer = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(timer)
  }, [])

  const handleDismiss = () => {
    setVisible(false)
    setTimeout(() => onDismiss(toast.id), 200)
  }

  return (
    <div
      className={`
        flex items-start gap-3 w-80 p-3 rounded border-l-4
        bg-board-card border border-board-border
        ${config.border}
        transition-all duration-200 ease-out
        ${visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <span className={`font-mono font-bold text-sm ${config.iconColor} shrink-0 mt-0.5`}>
        {config.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{toast.title}</p>
        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{toast.message}</p>
      </div>
      <button
        onClick={handleDismiss}
        className="text-text-secondary hover:text-text-primary text-sm shrink-0"
      >
        x
      </button>
    </div>
  )
}
