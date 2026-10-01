// Motion Grammar
// 
// This file defines a constrained vocabulary for all spatial reconfigurations.
// We avoid sharp, jarring movements in favor of soft, continuous, hypnotic fluidity.

import type { MotionProps, Transition } from 'motion/react'

export const transition = {
  base: {
    type: "tween",
    ease: "easeInOut",
    duration: 0.6
  },
  slow: {
    type: "tween",
    ease: "easeInOut",
    duration: 1.4
  },
  spatial: {
    type: "spring",
    stiffness: 120,
    damping: 24,
    mass: 1.2
  },
  pulse: {
    repeat: Infinity,
    repeatType: "mirror" as const,
    ease: "easeInOut",
    duration: 4
  }
} satisfies Record<string, Transition>

// 1. Move: For objects reorganizing structurally (e.g., Timeline rearranging)
export const move = {
  layout: true,
  transition: transition.spatial
} satisfies MotionProps

// 2. Fade: For contextual emergence (e.g., Reactions, text)
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: transition.base
} satisfies MotionProps

// 3. Scale: For focus state changes (e.g., Selected item expanding)
export const scale = {
  initial: { scale: 0.95, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.95, opacity: 0 },
  transition: transition.spatial
} satisfies MotionProps

// 4. Reveal: For new structural blocks (e.g., Replying to a thread)
export const reveal = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -20, opacity: 0 },
  transition: transition.base
} satisfies MotionProps
