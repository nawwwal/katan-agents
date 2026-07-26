import { useRef } from 'react'
import { soundBank, type PlayOptions, type SoundId } from '../audio/soundbank'

/**
 * The 2D layer's voice. `soundBank()` is a module singleton and a no-op until a
 * user gesture unlocks the audio context, so components can call this from any
 * handler without guarding.
 *
 * Three click weights on purpose: `soft` for picking up a tool, `click` for a
 * plain control, `deep` for a commit that changes the game state.
 */
export type UiSoundId = Extract<SoundId, 'ui-hover' | 'ui-click' | 'ui-click-soft' | 'ui-click-deep' | 'ui-open' | 'ui-close' | 'ui-error'>

export const uiSound = (id: UiSoundId, options?: PlayOptions) => soundBank().play(id, options)

/**
 * Delegated hover and click voicing for a whole control surface. Delegation keeps
 * the audio out of every individual handler; `data-weight` on a button picks the
 * click variant, so a commit lands heavier than picking up a tool.
 */
export const useControlSound = () => {
  const hovered = useRef<Element | null>(null)
  return {
    onPointerOver: (event: React.PointerEvent) => {
      const control = (event.target as HTMLElement).closest('button:not(:disabled), [role="button"]:not([aria-disabled="true"])')
      if (!control || control === hovered.current) return
      hovered.current = control
      uiSound('ui-hover', { gain: 0.55 })
    },
    onPointerOut: (event: React.PointerEvent) => {
      if ((event.target as HTMLElement).closest('button, [role="button"]') === hovered.current) hovered.current = null
    },
    onClick: (event: React.MouseEvent) => {
      const control = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
      if (!control || control.disabled) return
      const weight = control.dataset.weight
      uiSound(weight === 'deep' ? 'ui-click-deep' : weight === 'soft' ? 'ui-click-soft' : 'ui-click')
    },
  }
}
