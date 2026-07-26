import { useRef, useState } from 'react'

/**
 * One tab stop for a group of cards, arrow keys walking between them. That
 * replaces a run of sequential stops and keeps an overlapped card reachable
 * without relying on its visible strip being wide enough to hit.
 */
export const useRovingFocus = (length: number) => {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const index = length ? Math.min(active, length - 1) : 0
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -length : event.key === 'End' ? length : 0
    if (!step || !length) return
    event.preventDefault()
    const next = Math.max(0, Math.min(length - 1, index + step))
    setActive(next)
    listRef.current?.querySelectorAll<HTMLElement>('[data-roving]')[next]?.focus()
  }
  return { listRef, index, setActive, onKeyDown }
}
