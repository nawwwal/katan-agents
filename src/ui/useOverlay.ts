import { useEffect, useRef, type RefObject } from 'react'
import { uiSound } from './uiSound'

/**
 * Layers that stay live behind an overlay. A discard, a robber choice and a
 * trade are all decisions *about the board*, so the world stays pannable while
 * the overlay is up. None of these layers hold anything focusable, so the focus
 * trap is unaffected by the exemption.
 */
const WORLD_LAYERS = '.game-canvas, .ocean-layer, .vignette, .copyright-note'
const FOCUSABLE = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Sibling inerting, a focus trap, Escape and the open/close voicing, shared by
 * the modal stack and the trade table. `locked` is read through a ref so a
 * surface that becomes locked mid-life (an offer goes out, the table can no
 * longer be dismissed) does not replay the open sound or steal focus back.
 */
export function useOverlay(
  rootRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<HTMLElement | null>,
  { locked, onClose }: { locked: boolean; onClose: () => void },
) {
  const onCloseRef = useRef(onClose)
  const lockedRef = useRef(locked)
  onCloseRef.current = onClose
  lockedRef.current = locked

  useEffect(() => {
    const surface = surfaceRef.current
    const root = rootRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const siblings = root?.parentElement
      ? [...root.parentElement.children].filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element !== root && !element.matches(WORLD_LAYERS))
      : []
    const previousInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    uiSound('ui-open')
    ;(surface?.querySelector<HTMLElement>(FOCUSABLE) ?? surface)?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lockedRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !surface) return
      const controls = [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      uiSound('ui-close')
      siblings.forEach((element, index) => { element.inert = previousInert[index] })
      if (previousFocus?.isConnected) previousFocus.focus()
      else document.querySelector<HTMLElement>('.board-targets button, .turn-panel, .turn-marks button:not(:disabled)')?.focus()
    }
  }, [])
}
