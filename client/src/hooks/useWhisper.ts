import { useCallback, useRef, useState } from 'react'

export type WhisperStatus = 'idle' | 'loading' | 'recording' | 'transcribing'

export function useWhisper() {
  const [status, setStatus] = useState<WhisperStatus>('idle')
  const [progress, setProgress] = useState('')
  const [transcript, setTranscript] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const transcribingRef = useRef(false)
  const pendingRef = useRef(false)

  const transcribeAccumulated = useCallback(async () => {
    if (transcribingRef.current) {
      pendingRef.current = true
      return
    }
    if (chunksRef.current.length === 0) return

    transcribingRef.current = true
    try {
      const blob = new Blob([...chunksRef.current], { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')

      const res = await fetch('/api/transcribe', { method: 'POST', body: formData })
      if (res.ok) {
        const { text } = await res.json()
        if (text) setTranscript(text)
      }
    } catch (err) {
      console.error('[kanaban:whisper] interim transcription failed', err)
    } finally {
      transcribingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        transcribeAccumulated()
      }
    }
  }, [])

  const stop = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(transcript)
        return
      }

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        chunksRef.current = []

        if (blob.size === 0) {
          setStatus('idle')
          resolve(transcript)
          return
        }

        setStatus('transcribing')
        setProgress('Final transcription...')

        try {
          const formData = new FormData()
          formData.append('audio', blob, 'recording.webm')

          const res = await fetch('/api/transcribe', { method: 'POST', body: formData })
          if (res.ok) {
            const { text } = await res.json()
            const finalText = text?.trim() || transcript
            setTranscript(finalText)
            setStatus('idle')
            setProgress('')
            resolve(finalText)
          } else {
            setStatus('idle')
            setProgress('')
            resolve(transcript)
          }
        } catch (err) {
          console.error('[kanaban:whisper] final transcription failed', err)
          setStatus('idle')
          setProgress('')
          resolve(transcript)
        }
      }

      recorder.stop()
    })
  }, [transcript])

  const start = useCallback(async () => {
    if (status !== 'idle') return

    setStatus('loading')
    setProgress('Connecting mic...')
    setTranscript('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      streamRef.current = stream
      chunksRef.current = []
      transcribingRef.current = false
      pendingRef.current = false

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          transcribeAccumulated()
        }
      }

      // Fire ondataavailable every 2 seconds — GPU transcription is fast
      recorder.start(2000)

      setStatus('recording')
      setProgress('')
    } catch (err) {
      console.error('[kanaban:whisper] failed to start', err)
      setStatus('idle')
      setProgress('')
    }
  }, [status, transcribeAccumulated])

  const toggle = useCallback(async (): Promise<string> => {
    if (status === 'recording') {
      return stop()
    }
    if (status === 'idle') {
      await start()
    }
    return ''
  }, [status, start, stop])

  return { status, progress, transcript, toggle, stop }
}
