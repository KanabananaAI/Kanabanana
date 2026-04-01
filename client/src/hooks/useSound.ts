import { useCallback } from 'react'

export type SoundPreset = 'chime' | 'pop' | 'blip' | 'fanfare' | 'ping'

export const soundPresets: { id: SoundPreset; label: string; description: string }[] = [
  { id: 'chime', label: 'Chime', description: 'Gentle bell tone' },
  { id: 'pop', label: 'Pop', description: 'Quick pop sound' },
  { id: 'blip', label: 'Blip', description: 'Sci-fi blip' },
  { id: 'fanfare', label: 'Fanfare', description: 'Ascending melody' },
  { id: 'ping', label: 'Ping', description: 'Simple ping' },
]

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

function playChime() {
  const ctx = getAudioCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.3)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 1.0)
}

function playPop() {
  const ctx = getAudioCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(200, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08)
  gain.gain.setValueAtTime(0.5, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.1)
}

function playBlip() {
  const ctx = getAudioCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'square'
  osc.frequency.setValueAtTime(800, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.12)
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.15)
}

function playFanfare() {
  const ctx = getAudioCtx()
  const notes = [523.25, 659.25, 783.99] // C5, E5, G5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    const start = ctx.currentTime + i * 0.12
    osc.frequency.setValueAtTime(freq, start)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.35, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
    osc.start(start)
    osc.stop(start + 0.35)
  })
}

function playPing() {
  const ctx = getAudioCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1000, ctx.currentTime)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.5)
}

export const soundFunctions: Record<SoundPreset, () => void> = {
  chime: playChime,
  pop: playPop,
  blip: playBlip,
  fanfare: playFanfare,
  ping: playPing,
}

export function useSound() {
  const playSound = useCallback((_type?: string) => {
    const soundEnabled = localStorage.getItem('kanaban:soundEnabled') !== 'false'
    if (!soundEnabled) return
    try {
      const preset = (localStorage.getItem('kanaban:selectedSound') || 'chime') as SoundPreset
      const fn = soundFunctions[preset] ?? playChime
      fn()
    } catch {
      // Audio not supported
    }
  }, [])

  const previewSound = useCallback((preset: SoundPreset) => {
    try {
      const fn = soundFunctions[preset] ?? playChime
      fn()
    } catch {
      // Audio not supported
    }
  }, [])

  return { playSound, previewSound }
}
