import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useUI } from '../state/ui'
import { useData } from '../state/data'

// Reply tether: a hairline from the reply target's numeral to the Instrument.
// Purely visual (Locked Behaviors) — it reads positions, never drives reply logic.
// Drawn in viewport pixels and re-measured every frame while replying, so it stays
// attached through scrolling, follow-scroll and the Instrument's layout animation.
function useTetherPath(targetNumber: number | undefined) {
  const [d, setD] = useState<string | null>(null)
  useEffect(() => {
    if (targetNumber == null) {
      setD(null)
      return
    }
    let raf = 0
    const tick = () => {
      // The numeral's glyph box (the element itself is a stretched grid cell).
      const numeral = document.querySelector(`#item-${targetNumber} .item-no`)
      const glyphs = numeral ? document.createRange() : null
      glyphs?.selectNodeContents(numeral!)
      const from = glyphs?.getBoundingClientRect()
      // End just above the Instrument's reply label (or the ring if no label yet).
      const end =
        document.querySelector('.control-zone .control-label')?.getBoundingClientRect() ??
        document.querySelector('.control-zone .record-button')?.getBoundingClientRect()
      if (from && end) {
        const x1 = from.left + from.width / 2
        const y1 = from.bottom + 8
        const x2 = end.left + end.width / 2
        const y2 = end.top - 10
        // A plumb line down the numeral gutter until just below the target's thread
        // (so it never crosses the message), then one smooth bend into the
        // Instrument. Vertical tangents at the joint keep it a single line.
        const thread = numeral?.closest('.thread')?.getBoundingClientRect()
        const dropY = Math.min(Math.max((thread?.bottom ?? y1) + 24, y1 + 20), y2 - 40)
        const r = (y2 - dropY) * 0.6
        const f = (n: number) => n.toFixed(1)
        setD(`M ${f(x1)} ${f(y1)} L ${f(x1)} ${f(dropY)} C ${f(x1)} ${f(dropY + r)}, ${f(x2)} ${f(y2 - r)}, ${f(x2)} ${f(y2)}`)
      } else {
        setD(null)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [targetNumber])
  return d
}

export function ReplyTether() {
  const { state, activeItemId } = useUI()
  const targetNumber = useData((s) => (state === 'replying' && activeItemId ? s.itemsById[activeItemId]?.number : undefined))
  const d = useTetherPath(targetNumber)
  if (!d) return null
  return (
    <svg className="reply-tether" aria-hidden width="100%" height="100%">
      <motion.path
        key={targetNumber}
        d={d}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={0.75}
        strokeOpacity={0.35}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  )
}

export function Anchors() {
  const { state, activeItemId } = useUI()

  const isRecording = state === 'recording'
  const isComposing = state === 'composing'
  const isReplying = state === 'replying' || state === 'selected'

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: -1,
      overflow: 'hidden'
    }}>
      {/* 
        Abstract Graphic 1: Primary Slate Blob 
        Orbits slowly in the background. Reacts to composing and replying.
      */}
      <motion.div
        animate={{
          // Replying shifts the room only slightly (~25% of the old 1.2 / 0.4 swing).
          scale: isComposing ? 0.8 : isReplying ? 1.08 : [1, 1.05, 1],
          opacity: isComposing ? 0 : isReplying ? 0.22 : [0.15, 0.2, 0.15],
          rotate: isComposing ? 0 : [0, 10, 0]
        }}
        transition={{ 
          scale: { duration: 1.2, ease: "easeInOut" },
          opacity: { duration: 1.2, ease: "easeInOut" },
          rotate: { repeat: Infinity, duration: 25, ease: "easeInOut" }
        }}
        style={{
          position: 'absolute',
          top: '-20vh',
          left: '-20vw',
          width: '120vw',
          height: '100vh',
          background: 'var(--muted)',
          borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%',
          filter: 'blur(60px)',
          mixBlendMode: 'screen'
        }}
      />

      {/* 
        Abstract Graphic 2: Deep Sepia Blob
        Sits lower right, orbits in counter-phase. Tightens when recording.
      */}
      <motion.div
        animate={{
          scale: isRecording ? 1.4 : isComposing ? 0.5 : [1, 1.1, 1],
          opacity: isRecording ? 0.3 : isComposing ? 0 : [0.1, 0.15, 0.1],
          rotate: isRecording ? 45 : [0, -15, 0]
        }}
        transition={{ 
          scale: { duration: 0.8, ease: "easeInOut" },
          opacity: { duration: 0.8, ease: "easeInOut" },
          rotate: { repeat: Infinity, duration: 30, ease: "easeInOut" }
        }}
        style={{
          position: 'absolute',
          bottom: '-30vh',
          right: '-10vw',
          width: '100vw',
          height: '80vh',
          background: 'var(--line)',
          borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%',
          filter: 'blur(80px)'
        }}
      />

      {/* Reply tether: see <ReplyTether /> (its own layer, above the bottom fade). */}
    </div>
  )
}
