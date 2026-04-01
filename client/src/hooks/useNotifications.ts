import { useCallback, useEffect, useState } from 'react'
import { useSocket } from './useSocket'
import { useSound } from './useSound'
import type { NotificationEvent } from '../types'

export interface Toast {
  id: string
  type: NotificationEvent['type']
  title: string
  message: string
  timestamp: number
}

export function useNotifications() {
  const socket = useSocket()
  const { playSound } = useSound()
  const [toasts, setToasts] = useState<Toast[]>([])

  // Request browser notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((event: NotificationEvent) => {
    console.log(`%c[kanaban:notify] ${event.type}: ${event.title} — ${event.message}`, 'color:#f472b6;font-weight:bold')

    // Don't show error pop-outs as toasts
    if (event.type === 'error') return

    const toast: Toast = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: event.type,
      title: event.title,
      message: event.message,
      timestamp: Date.now(),
    }

    setToasts((prev) => [...prev, toast])

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id))
    }, 5000)

    // Play sound based on event type
    if (event.sound) {
      playSound(event.sound as 'success' | 'error' | 'alert' | 'subtle')
    } else {
      switch (event.type) {
        case 'completed':
          playSound('success')
          break
        case 'needs-input':
          playSound('alert')
          break
        default:
          playSound('subtle')
          break
      }
    }

    // Show browser notification if permitted and page is not focused
    if (
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      new Notification(event.title, {
        body: event.message,
        icon: '/favicon.ico',
      })
    }
  }, [playSound])

  useEffect(() => {
    socket.on('notification', addToast)
    return () => {
      socket.off('notification', addToast)
    }
  }, [socket, addToast])

  return { toasts, dismissToast }
}
