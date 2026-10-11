import type { ReactNode, HTMLAttributes } from 'react'

export interface ActivityItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  summary?: ReactNode
  timestamp?: ReactNode
  className?: string
}

export function ActivityItem({ icon, title, summary, timestamp, className = '', ...props }: ActivityItemProps) {
  return (
    <div className={`ui-activity-item ${className}`.trim()} {...props}>
      {icon && <div className="ui-activity-icon">{icon}</div>}
      <div className="ui-activity-body">
        <span className="ui-activity-title">{title}</span>
        {summary && <span className="ui-activity-summary"> {summary}</span>}
      </div>
      {timestamp && <span className="ui-activity-time">{timestamp}</span>}
    </div>
  )
}

export function ActivityList({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ui-activity-list ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
