import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { taskPath } from './links'

export function TaskLink({ taskKey, children, className }: { taskKey: string; children: ReactNode; className?: string }) {
  const location = useLocation()
  return <Link className={className} to={taskPath(location.pathname, taskKey)}>{children}</Link>
}
