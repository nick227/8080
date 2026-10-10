/** Task links retain the current project shell and work from every surface. */
export function projectPath(pathname: string) {
  return pathname.match(/^\/room\/[^/]+/)?.[0] ?? pathname
}

export function tasksPath(pathname: string) {
  return `${projectPath(pathname)}/tasks`
}

export function taskPath(pathname: string, taskKey: string) {
  return `${tasksPath(pathname)}/${encodeURIComponent(taskKey)}`
}
