import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'

/**
 * The wait, shown honestly.
 *
 * Progress is the real weighted fraction of the preload, not a timed fake, and
 * the bar only reaches full when the scene has also finished compiling its
 * shaders. Styles are inline because this cannot depend on the stylesheet
 * having loaded -- it is the first thing on screen.
 */

type Props = {
  visible: boolean
  progress: number
  label: string
}

const shell: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'grid',
  placeItems: 'center',
  background: 'radial-gradient(120% 90% at 50% 40%, #123244 0%, #0a1a24 55%, #060e14 100%)',
  transition: 'opacity 420ms cubic-bezier(.18,.9,.28,1)',
}

const panel: CSSProperties = {
  display: 'grid',
  justifyItems: 'center',
  gap: 22,
  width: 'min(420px, 76vw)',
  textAlign: 'center',
}

const wordmark: CSSProperties = {
  margin: 0,
  fontFamily: '"Katan Display", Georgia, serif',
  fontSize: 'clamp(30px, 4vw, 44px)',
  fontWeight: 600,
  letterSpacing: '.22em',
  textIndent: '.22em',
  color: '#f1e4c1',
  textShadow: '0 1px 0 rgba(0,0,0,.55), 0 18px 42px rgba(0,0,0,.5)',
}

const track: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 4,
  borderRadius: 999,
  background: 'rgba(241, 228, 193, .12)',
  overflow: 'hidden',
}

const caption: CSSProperties = {
  margin: 0,
  fontFamily: '"Katan Text", system-ui, sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'rgba(241, 228, 193, .58)',
  display: 'flex',
  gap: 12,
  alignItems: 'baseline',
}

export function LoadingScreen({ visible, progress, label }: Props) {
  const [mounted, setMounted] = useState(visible)

  // Keep the node around through the fade so the reveal is a dissolve into the
  // board rather than a hard cut.
  useEffect(() => {
    if (visible) { setMounted(true); return }
    const timer = setTimeout(() => setMounted(false), 460)
    return () => clearTimeout(timer)
  }, [visible])

  if (!mounted) return null
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)

  return <div
    style={{ ...shell, opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
    role="status"
    aria-live="polite"
    aria-busy={visible}
  >
    <div style={panel}>
      <p style={wordmark}>KATAN</p>
      <div style={track}>
        <div style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: 'left center',
          transform: `scaleX(${Math.max(0.012, progress)})`,
          transition: 'transform 260ms cubic-bezier(.18,.9,.28,1)',
          background: 'linear-gradient(90deg, #9a7c46, #d8b168 60%, #ffe9b3)',
          boxShadow: '0 0 16px rgba(216, 177, 104, .45)',
        }} />
      </div>
      <p style={caption}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(241, 228, 193, .82)' }}>{percent}%</span>
      </p>
    </div>
  </div>
}
