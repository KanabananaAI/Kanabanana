import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

let socketInstance: Socket | null = null

function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Force WebSocket first to avoid polling transport issues
      transports: ['websocket', 'polling'],
    })

    socketInstance.on('connect', () => {
      console.log(`%c[kanaban:socket] Connected (id=${socketInstance!.id})`, 'color:#22c55e')
    })
    socketInstance.on('disconnect', (reason) => {
      console.log(`%c[kanaban:socket] Disconnected: ${reason}`, 'color:#ef4444')
    })
    socketInstance.on('reconnect_attempt', (attempt) => {
      console.log(`%c[kanaban:socket] Reconnecting... attempt #${attempt}`, 'color:#eab308')
    })
    socketInstance.on('reconnect', () => {
      console.log(`%c[kanaban:socket] Reconnected (id=${socketInstance!.id})`, 'color:#22c55e')
    })
    socketInstance.on('connect_error', (err) => {
      console.log(`%c[kanaban:socket] Connection error: ${err.message}`, 'color:#ef4444')
    })
  }
  return socketInstance
}

export function useSocket(): Socket {
  const socketRef = useRef<Socket>(getSocket())

  // Ensure socketRef always points to the current singleton
  // (handles Vite HMR module re-evaluation)
  if (socketInstance && socketRef.current !== socketInstance) {
    socketRef.current = socketInstance
  }

  useEffect(() => {
    const socket = socketRef.current
    if (!socket.connected) {
      socket.connect()
    }
    return () => {
      // Don't disconnect the singleton on unmount;
      // individual components manage their own room joins.
    }
  }, [])

  return socketRef.current
}

export { getSocket }
