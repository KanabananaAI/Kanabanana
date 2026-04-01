import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { useSocket } from '../hooks/useSocket'
import 'xterm/css/xterm.css'

interface OrchestratorTerminalProps {
  visible: boolean
  fill?: boolean
}

export default function OrchestratorTerminal({ visible, fill }: OrchestratorTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socket = useSocket()

  useEffect(() => {
    if (!visible || !containerRef.current) return

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
      // May throw "dimensions" error in React strict mode
    }

    const syncSize = () => {
      try {
        fitAddon.fit()
        const { cols, rows } = term
        if (cols > 0 && rows > 0) {
          socket.emit('orchestrator:resize', { cols, rows })
        }
      } catch {
        // Container may have zero dimensions
      }
    }

    const fitTimer = setTimeout(syncSize, 100)

    termRef.current = term
    fitAddonRef.current = fitAddon

    console.log('%c[kanaban:orch-term] Mounted orchestrator terminal', 'color:#a855f7')

    // Listen for output
    let outputBytes = 0
    const handleOutput = (data: string) => {
      outputBytes += data.length
      if (outputBytes <= data.length) {
        console.log(`%c[kanaban:orch-term] First output chunk (${data.length} chars)`, 'color:#a855f7')
      }
      term.write(data)
    }
    socket.on('orchestrator:output', handleOutput)

    // Listen for clear signal
    const handleClear = () => {
      console.log('%c[kanaban:orch-term] Clearing terminal (restart)', 'color:#eab308')
      term.reset()
      outputBytes = 0
    }
    socket.on('orchestrator:clear', handleClear)

    // Send user input
    const disposable = term.onData((data: string) => {
      socket.emit('orchestrator:input', { input: data })
    })

    // Handle resize
    const handleResize = () => syncSize()
    window.addEventListener('resize', handleResize)

    let resizeObserver: ResizeObserver | null = null
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => syncSize())
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      console.log(`%c[kanaban:orch-term] Unmounting orchestrator terminal (total output: ${outputBytes} chars)`, 'color:#a855f7')
      clearTimeout(fitTimer)
      disposable.dispose()
      socket.off('orchestrator:output', handleOutput)
      socket.off('orchestrator:clear', handleClear)
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [visible, socket])

  // Re-fit on visibility change
  useEffect(() => {
    if (visible && fitAddonRef.current && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit()
          const term = termRef.current
          if (term && term.cols > 0 && term.rows > 0) {
            socket.emit('orchestrator:resize', { cols: term.cols, rows: term.rows })
          }
        } catch {
          // ignore
        }
      })
    }
  }, [visible, socket])

  if (!visible) return null

  return (
    <div
      className={fill ? 'xterm-container h-full' : 'xterm-container mt-2'}
      ref={containerRef}
      style={fill ? undefined : { height: 240 }}
    />
  )
}
