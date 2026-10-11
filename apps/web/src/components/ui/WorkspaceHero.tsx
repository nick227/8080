import type { ReactNode } from 'react'
import { Badge } from './Badge'

export interface WorkspaceHeroProps {
  name: string
  avatar?: string
  status?: string
  tagline?: string
  actions?: ReactNode
}

export function WorkspaceHero({
  name,
  avatar,
  status = 'Active',
  tagline = 'A home for our brand, team, operations, and growth.',
  actions,
}: WorkspaceHeroProps) {
  const initial = name ? name.charAt(0).toUpperCase() : 'W'

  return (
    <div className="ui-workspace-hero">
      <div className="ui-workspace-hero-main">
        <div className="ui-workspace-hero-avatar">
          {avatar ? <img src={avatar} alt={name} /> : <span>{initial}</span>}
        </div>
        <div className="ui-workspace-hero-info">
          <div className="ui-workspace-hero-header">
            <h1 className="ui-workspace-hero-title">{name}</h1>
            {status && (
              <Badge variant="active" showDot>
                {status}
              </Badge>
            )}
          </div>
          {tagline && <p className="ui-workspace-hero-tagline">{tagline}</p>}
        </div>
      </div>
      {actions && <div className="ui-workspace-hero-actions">{actions}</div>}
    </div>
  )
}
