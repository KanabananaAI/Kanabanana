import type { WhisperStatus } from '../hooks/useWhisper'

interface DictateButtonProps {
  status: WhisperStatus
  progress: string
  onToggle: () => void
  className?: string
}

export default function DictateButton({ status, progress, onToggle, className = '' }: DictateButtonProps) {
  const isRecording = status === 'recording'
  const isBusy = status === 'loading' || status === 'transcribing'

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isBusy}
      title={
        isRecording
          ? 'Stop recording'
          : isBusy
            ? progress
            : 'Dictate with Whisper'
      }
      className={`shrink-0 w-8 h-8 flex items-center justify-center rounded border transition-colors ${
        isRecording
          ? 'bg-red-900/40 border-red-700 text-red-400 hover:bg-red-900/60'
          : isBusy
            ? 'bg-board-bg border-board-border text-text-muted cursor-wait'
            : 'bg-board-bg border-board-border text-text-secondary hover:text-text-primary hover:border-text-secondary'
      } ${className}`}
    >
      {isBusy ? (
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
          {isRecording && <circle cx="12" cy="7" r="2" fill="currentColor" className="animate-pulse" />}
        </svg>
      )}
    </button>
  )
}
