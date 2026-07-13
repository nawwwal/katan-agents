import { useEffect, useRef, useState } from 'react'
import type { GamePresentation } from '../game/useGame'

const BUILD_ACTIONS = new Set(['place-settlement', 'place-road', 'build-settlement', 'build-road', 'build-city'])

export function useGameAudio(presentation: GamePresentation | undefined, victorious: boolean) {
  const [muted, setMuted] = useState(false)
  const contextRef = useRef<AudioContext | undefined>(undefined)
  const victoryPlayed = useRef(false)

  useEffect(() => {
    const unlock = () => {
      contextRef.current ??= new AudioContext()
      void contextRef.current.resume()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  useEffect(() => {
    if (muted || !presentation || !contextRef.current) return
    const context = contextRef.current
    const tone = (frequency: number, duration: number, delay = 0, type: OscillatorType = 'triangle', volume = 0.035) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + delay
      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, start)
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, frequency * 0.82), start + duration)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + duration + 0.02)
    }
    if (presentation.actionType === 'roll-dice') {
      tone(165, 0.16, 0, 'square', 0.018)
      tone(232, 0.17, 0.12, 'square', 0.016)
      tone(310, 0.22, 0.24, 'triangle', 0.027)
    } else if (BUILD_ACTIONS.has(presentation.actionType)) {
      tone(196, 0.22, 0, 'triangle', 0.034)
      tone(294, 0.28, 0.08, 'triangle', 0.032)
    } else if (presentation.actionType === 'buy-development') {
      tone(330, 0.2, 0, 'sine', 0.028)
      tone(440, 0.3, 0.11, 'sine', 0.028)
    } else if (presentation.actionType !== 'end-turn') tone(220, 0.18, 0, 'sine', 0.024)
  }, [muted, presentation])

  useEffect(() => {
    if (!victorious) { victoryPlayed.current = false; return }
    if (muted || victoryPlayed.current || !contextRef.current) return
    victoryPlayed.current = true
    const context = contextRef.current
    ;[261.6, 329.6, 392, 523.3].forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + index * 0.12
      oscillator.type = 'triangle'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.58)
    })
  }, [muted, victorious])

  return { muted, setMuted }
}
