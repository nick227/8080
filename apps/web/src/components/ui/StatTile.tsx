import type { ReactNode, HTMLAttributes } from 'react'

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  value: ReactNode
  trend?: ReactNode
  trendDirection?: 'up' | 'down' | 'neutral'
  className?: string
}

export function StatTile({ label, value, trend, trendDirection, className = '', ...props }: StatTileProps) {
  return (
    <div className={`ui-stat-tile ${className}`.trim()} {...props}>
      <span className="ui-stat-label">{label}</span>
      <div className="ui-stat-value">{value}</div>
      {trend && (
        <span className={`ui-stat-trend ${trendDirection ? `ui-stat-trend-${trendDirection}` : ''}`.trim()}>
          {trend}
        </span>
      )}
    </div>
  )
}

export function StatGrid({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ui-stat-grid ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
