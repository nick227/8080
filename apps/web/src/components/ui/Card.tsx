import type { ReactNode, HTMLAttributes } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`ui-card ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function CardHeader({ icon, title, description, actions, className = '', ...props }: CardHeaderProps) {
  return (
    <div className={`ui-card-header ${className}`.trim()} {...props}>
      <div className="ui-card-header-main">
        {icon && <div className="ui-card-icon">{icon}</div>}
        <div className="ui-card-header-text">
          <h3 className="ui-card-title">{title}</h3>
          {description && <p className="ui-card-description">{description}</p>}
        </div>
      </div>
      {actions && <div className="ui-card-actions">{actions}</div>}
    </div>
  )
}

export function CardContent({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`ui-card-content ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`ui-card-footer ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
