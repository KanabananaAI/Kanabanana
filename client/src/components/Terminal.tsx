import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { useSocket } from '../hooks/useSocket'
import 'xterm/css/xterm.css'

interface TerminalProps {
  taskId: string
  visible: boolean
  fill?: boolean
  mode?: 'pty' | 'chat'  // 'pty' = raw keystroke forwarding, 'chat' = line-buffered input
}

export default function Terminal({ taskId, visible, fill, mode }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socket = useSocket()

  // Core terminal lifecycle — create once, destroy on unmount or taskId change
  useEffect(() => {
    if (!containerRef.current) return

    const isDark = window.document.documentElement.classList.contains('dark')
    const theme = isDark
      ? {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#2a2a2a',
        black: '#0a0a0a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e5e5e5',
        brightBlack: '#6b7280',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#f5f5f5',
      }
      : {
        background: '#ffffff',
        foreground: '#1a1a1a',
        cursor: '#1a1a1a',
        cursorAccent: '#ffffff',
        selectionBackground: '#e5e5e5',
        black: '#1a1a1a',
        red: '#dc2626',
        green: '#16a34a',
        yellow: '#ca8a04',
        blue: '#2563eb',
        magenta: '#9333ea',
        cyan: '#0891b2',
        white: '#1a1a1a',
        brightBlack: '#4b5563',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#111827',
      }

    const term = new XTerm({
      theme,
      fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    try {
      term.open(containerRef.current)
    } catch {
      // May throw "dimensions" error in React strict mode — non-fatal
    }

    termRef.current = term
    fitAddonRef.current = fitAddon

    const isResponderChat = false
    const effectiveMode = isResponderChat ? 'chat' : (mode || 'pty')

    const syncSize = () => {
      if (!termRef.current || !term.element || term.element.clientWidth === 0) return
      try {
        fitAddon.fit()
      } catch {
        // Container may have zero dimensions
      }
    }

    // Multiple fit attempts — layout may not be settled on first try
    const timers = [
      setTimeout(syncSize, 50),
      setTimeout(syncSize, 200),
      setTimeout(syncSize, 500),
    ]

    // Resize on window resize
    const handleResize = () => syncSize()
    window.addEventListener('resize', handleResize)

    // ResizeObserver for container size changes (drag resize, layout shifts)
    let resizeObserver: ResizeObserver | null = null
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => syncSize())
      resizeObserver.observe(containerRef.current)
    }

    if (effectiveMode === 'chat') {
      // ─── Chat mode: line-buffered input via message bus ───
      // No PTY wiring — no room join/leave, no task:output/task:input
      console.log(`%c[kanaban:term] Chat mode mounted for ${taskId.slice(0, 8)}`, 'color:#06b6d4')

      let lineBuffer = ''

      const disposable = term.onData((data: string) => {
        for (let i = 0; i < data.length; i++) {
          const ch = data[i]

          if (ch === '\r' || ch === '\n') {
            // Enter pressed — send the buffered line
            if (lineBuffer.trim()) {
              socket.emit('bus:human-message-from-ui', {
                text: lineBuffer,
                taskId,
              })
              term.write('\r\n')
              term.write('\x1b[90mProcessing...\x1b[0m\r\n')
            } else {
              term.write('\r\n')
              term.write('\x1b[36mkanaban>\x1b[0m ')
            }
            lineBuffer = ''
          } else if (ch === '\x7f' || ch === '\b') {
            // Backspace
            if (lineBuffer.length > 0) {
              lineBuffer = lineBuffer.slice(0, -1)
              term.write('\b \b')
            }
          } else if (ch === '\x03') {
            // Ctrl+C — clear current line
            term.write('^C\r\n')
            lineBuffer = ''
            term.write('\x1b[36mkanaban>\x1b[0m ')
          } else if (ch === '\x1b') {
            // Escape sequence (arrow keys, etc.) — skip
            if (i + 2 < data.length && data[i + 1] === '[') {
              i += 2
            }
          } else if (ch >= ' ') {
            // Printable character
            lineBuffer += ch
            term.write(ch)
          }
        }
      })

      // Show header
      term.write('\x1b[36m╭─ Kanaban Responder Chat ─────────────────────╮\x1b[0m\r\n')
      term.write('\x1b[36m│\x1b[0m Type naturally to manage your board.         \x1b[36m│\x1b[0m\r\n')
      term.write('\x1b[36m│\x1b[0m Try: "show me the board" or "create a task"   \x1b[36m│\x1b[0m\r\n')
      term.write('\x1b[36m╰──────────────────────────────────────────────╯\x1b[0m\r\n\r\n')

      // Load chat history from server
      const workspaceId = taskId.replace('responder-chat:', '')
      socket.emit('responder:history', { workspaceId })

      const handleHistoryResponse = (data: { messages: Array<{ role: string; content: string }> }) => {
        if (data.messages && data.messages.length > 0) {
          term.write('\x1b[90m── previous messages ──\x1b[0m\r\n\r\n')
          for (const msg of data.messages) {
            if (msg.role === 'user') {
              term.write(`\x1b[36mkanaban>\x1b[0m ${msg.content}\r\n`)
            } else {
              // Render assistant messages with dimmed color, converting newlines
              const lines = msg.content.replace(/\n/g, '\r\n')
              term.write(`\x1b[37m${lines}\x1b[0m\r\n`)
            }
          }
          term.write('\r\n\x1b[90m── end of history ──\x1b[0m\r\n\r\n')
        }
        term.write('\x1b[36mkanaban>\x1b[0m ')
        socket.off('responder:history-response', handleHistoryResponse)
      }
      socket.on('responder:history-response', handleHistoryResponse)

      // Listen for streamed output chunks
      const handleChunk = (data: { chunk: string }) => {
        term.write(data.chunk.replace(/\n/g, '\r\n'))
      }
      // On final reply, show the prompt
      const handleReply = (_data: { text: string; threadId?: string }) => {
        term.write('\r\n\x1b[36mkanaban>\x1b[0m ')
      }
      socket.on('responder:output-chunk', handleChunk)
      socket.on('bus:responder-reply', handleReply)

      return () => {
        timers.forEach(clearTimeout)
        disposable.dispose()
        socket.off('responder:output-chunk', handleChunk)
        socket.off('bus:responder-reply', handleReply)
        socket.off('responder:history-response', handleHistoryResponse)
        window.removeEventListener('resize', handleResize)
        resizeObserver?.disconnect()
        term.dispose()
        termRef.current = null
        fitAddonRef.current = null
      }
    }

    // ─── PTY mode: raw keystroke forwarding (existing behavior) ───
    const isChat = taskId.startsWith('agent-chat:')
    const chatId = isChat ? taskId.replace('agent-chat:', '') : null
    const joinEvent = isChat ? 'agent-chat:join' : 'task:join'
    const leaveEvent = isChat ? 'agent-chat:leave' : 'task:leave'
    const outputEvent = isChat ? 'agent-chat:output' : 'task:output'
    const resizeEvent = isChat ? 'agent-chat:resize' : 'task:resize'

    // Local echo mode — active when the PTY session has exited.
    // Lets the user see keystrokes in the terminal even before a restart echo arrives.
    let sessionDead = false

    const syncPtySize = () => {
      if (!termRef.current || !term.element || term.element.clientWidth === 0) return
      try {
        fitAddon.fit()
        const { cols, rows } = term
        if (cols > 0 && rows > 0) {
          console.log(`%c[kanaban:term] Syncing PTY size ${cols}x${rows} for task=${taskId.slice(0, 8)}`, 'color:#06b6d4')
          socket.emit(resizeEvent, isChat ? { chatId, cols, rows } : { taskId, cols, rows })
        }
      } catch {
        // Container may have zero dimensions
      }
    }

    // Sync PTY size on multiple attempts
    setTimeout(syncPtySize, 50)
    setTimeout(syncPtySize, 200)
    setTimeout(syncPtySize, 500)

    // Self-contained room join — Terminal manages its own room
    socket.emit(joinEvent, isChat ? chatId : taskId)
    console.log(`%c[kanaban:term] Mounted + joined room for task=${taskId.slice(0, 8)}`, 'color:#06b6d4')

    // Listen for output
    let outputBytes = 0
    const handleOutput = (data: any) => {
      const matchId = isChat ? data.chatId : data.taskId
      const target = isChat ? chatId : taskId
      if (matchId !== target) return
      sessionDead = false  // PTY is alive — disable local echo
      outputBytes += data.data.length
      if (outputBytes <= data.data.length) {
        console.log(`%c[kanaban:term] First output chunk received (${data.data.length} chars) for task=${taskId.slice(0, 8)}`, 'color:#06b6d4')
      }
      term.write(data.data)
    }
    socket.on(outputEvent, handleOutput)

    // Clear on restart/respawn — also re-sync dimensions so the new PTY gets correct size
    const handleClear = (payload: { taskId: string }) => {
      if (payload.taskId === taskId) {
        console.log(`%c[kanaban:term] Clearing terminal for task=${taskId.slice(0, 8)} (restart)`, 'color:#eab308')
        sessionDead = false  // New session starting
        term.reset()
        outputBytes = 0
        syncPtySize()
        setTimeout(syncPtySize, 100)
      }
    }
    socket.on('task:clear', handleClear)

    // On reconnect: re-join room (triggers buffer replay from server) and clear stale output
    const handleConnect = () => {
      console.log(`%c[kanaban:term] Socket reconnected, re-joining room for task=${taskId.slice(0, 8)}`, 'color:#eab308')
      sessionDead = false
      term.reset()
      outputBytes = 0
      socket.emit(joinEvent, isChat ? chatId : taskId)
      setTimeout(syncPtySize, 100)
    }
    socket.on('connect', handleConnect)

    // Show exit message with restart hint
    const handleExit = (payload: { taskId: string; exitCode: number; signal?: number }) => {
      if (payload.taskId !== taskId) return
      sessionDead = true  // Enable local echo until a new session starts
      const reason = payload.signal != null
        ? `signal=${payload.signal}`
        : `exitCode=${payload.exitCode}`
      const color = payload.exitCode === 0 ? '\x1b[32m' : '\x1b[33m'
      term.write(`\r\n${color}[Session ended: ${reason}]\x1b[0m\r\n`)
      term.write(`\x1b[90m[Type anything to restart the session]\x1b[0m\r\n`)
    }
    socket.on('task:exit', handleExit)

    // Sync PTY dimensions whenever xterm.js internally resizes
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (cols > 0 && rows > 0) {
        socket.emit(resizeEvent, isChat ? { chatId, cols, rows } : { taskId, cols, rows })
      }
    })

    // Send user input — chat terminals use agent-chat:input, task terminals use task:input
    const disposable = term.onData((data: string) => {
      console.log(`%c[kanaban:term] Input sent to task=${taskId.slice(0, 8)}: ${JSON.stringify(data).slice(0, 60)}`, 'color:#f97316')
      if (isChat) {
        socket.emit('agent-chat:input', { chatId, input: data })
      } else {
        // Local echo when the PTY session is dead — characters appear immediately
        // without waiting for the round-trip echo (which won't come if PTY is gone).
        // When a new session starts, task:clear fires and resets sessionDead=false.
        if (sessionDead) {
          for (let i = 0; i < data.length; i++) {
            const ch = data[i]
            if (ch === '\r') {
              term.write('\r\n')
            } else if (ch === '\x7f' || ch === '\b') {
              term.write('\b \b')
            } else if (ch === '\x1b') {
              // Skip escape sequences (arrow keys, function keys, etc.)
              if (i + 1 < data.length && (data[i + 1] === '[' || data[i + 1] === 'O')) {
                i += 2  // ESC [ x  or  ESC O x
              } else {
                i += 1
              }
            } else if (ch >= ' ') {
              term.write(ch)
            }
          }
        }
        socket.emit('task:input', { taskId, input: data })
      }
    })

    return () => {
      console.log(`%c[kanaban:term] Unmounting terminal for task=${taskId.slice(0, 8)} (total output: ${outputBytes} chars)`, 'color:#06b6d4')
      timers.forEach(clearTimeout)
      resizeDisposable.dispose()
      disposable.dispose()
      socket.off(outputEvent, handleOutput)
      socket.off('task:clear', handleClear)
      socket.off('task:exit', handleExit)
      socket.off('connect', handleConnect)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
      socket.emit(leaveEvent, isChat ? chatId : taskId)
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [taskId, socket, mode])

  // Re-fit when visibility changes (e.g. slot becomes active)
  useEffect(() => {
    const isResponderChat = false
    const effectiveMode = isResponderChat ? 'chat' : (mode || 'pty')
    const isChat = taskId.startsWith('agent-chat:')
    const chatId = isChat ? taskId.replace('agent-chat:', '') : null
    const resizeEvent = isChat ? 'agent-chat:resize' : 'task:resize'
    if (visible && fitAddonRef.current && termRef.current) {
      const tryFit = () => {
        const term = termRef.current
        if (!term || !term.element || term.element.clientWidth === 0) return
        try {
          fitAddonRef.current?.fit()
          // Only sync PTY size for PTY mode terminals
          if (effectiveMode !== 'chat' && term.cols > 0 && term.rows > 0) {
            socket.emit(resizeEvent, isChat ? { chatId, cols: term.cols, rows: term.rows } : { taskId, cols: term.cols, rows: term.rows })
          }
        } catch {
          // ignore
        }
      }
      requestAnimationFrame(tryFit)
      const timer = setTimeout(tryFit, 100)
      return () => clearTimeout(timer)
    }
  }, [visible, taskId, socket, mode])

  return (
    <div
      className={fill ? 'xterm-container h-full' : 'xterm-container mt-2'}
      ref={containerRef}
      style={fill ? undefined : { height: 240 }}
    />
  )
}
