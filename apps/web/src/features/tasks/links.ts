/** The page that owns the desks: a room (`/room/:id`) or a company (`/c/:id`). */
export const BASE_PATH = /^\/(?:room|c)\/[^/]+/

/** Task links retain the current room or company shell and work from every surface. */
export function projectPath(pathname: string) {
  return pathname.match(BASE_PATH)?.[0] ?? pathname
}

/** True on company routes, where the desk is a path segment rather than `?desk=`. */
export function onCompanyPath(pathname: string) {
  return pathname.startsWith('/c/')
}

export function tasksPath(pathname: string) {
  return `${projectPath(pathname)}/tasks`
}

export function taskPath(pathname: string, taskKey: string) {
  return `${tasksPath(pathname)}/${encodeURIComponent(taskKey)}`
}
