import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

import { useUI } from '../state/ui'

export function Blobs({ count = 3 }: { count?: number }) {
  const [blobs, setBlobs] = useState(Array.from({ length: count }))
  const ui = useUI()
  const isRecording = ui.state === 'recording' || ui.state === 'reviewing'

  useEffect(() => {
    setBlobs(Array.from({ length: count }))
  }, [count])

  return (
    <div 
      className="ambient-blobs" 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        pointerEvents: 'none', 
        zIndex: -1,
        overflow: 'hidden',
        filter: isRecording ? 'blur(80px) opacity(0.6)' : 'blur(100px) opacity(0.4)',
        background: 'var(--bg)',
        transition: 'filter 1s ease'
      }}
    >
      {blobs.map((_, i) => {
        const isFocus = i === 0
        return (
          <motion.div
            key={i}
            animate={{
              x: isRecording && isFocus ? ['0vw', '1vw', '-1vw', '0vw'] : ['0vw', `${(i % 2 === 0 ? 1 : -1) * 20}vw`, '0vw'],
              y: isRecording && isFocus ? ['30vh', '31vh', '29vh', '30vh'] : ['0vh', `${(i % 3 === 0 ? 1 : -1) * 30}vh`, '0vh'],
              scale: isRecording && isFocus ? [1, 1.05, 1] : [1, 1.2, 1],
              opacity: isRecording && isFocus ? [0.8, 1, 0.8] : [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: isRecording && isFocus ? 0.5 : 15 + i * 5,
              repeat: Infinity,
              repeatType: 'reverse',
              ease: 'easeInOut',
            }}
            style={{
              position: 'absolute',
              width: '40vmax',
              height: '40vmax',
              borderRadius: '50%',
              background: isFocus ? 'var(--signal)' : i === 1 ? 'var(--ink)' : 'var(--bg-elevated)',
              left: `${30 + i * 20}%`,
              top: `${20 + i * 20}%`,
              mixBlendMode: 'multiply'
            }}
          />
        )
      })}
    </div>
  )
}
