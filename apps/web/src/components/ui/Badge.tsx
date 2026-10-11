import type { ReactNode, HTMLAttributes } from 'react'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  variant?: 'active' | 'connected' | 'default' | 'disconnected' | 'warning'
  showDot?: boolean
  className?: string
}

export function Badge({ children, variant = 'default', showDot = false, className = '', ...props }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge-${variant} ${className}`.trim()} {...props}>
      {showDot && <span className="ui-badge-dot" />}
      <span>{children}</span>
    </span>
  )
}
