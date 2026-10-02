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
      const item = document.querySelector(`#item-${targetNumber}`)
      const from = item?.getBoundingClientRect()
      // End just above the Instrument's reply label (or the ring if no label yet).
      const end =
        document.querySelector('.control-zone .control-label')?.getBoundingClientRect() ??
        document.querySelector('.control-zone .record-button')?.getBoundingClientRect()
      if (from && end) {
        const x1 = from.left + Math.min(24, from.width / 2)
        const y1 = from.bottom
        const x2 = end.left + end.width / 2
        const y2 = end.top - 10
        // A plumb line down the numeral gutter until just below the target's thread
        // (so it never crosses the message), then one smooth bend into the
        // Instrument. Vertical tangents at the joint keep it a single line.
        const thread = item?.closest('.thread')?.getBoundingClientRect()
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
  return null;
}
