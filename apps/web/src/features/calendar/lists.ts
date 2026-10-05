export type TaskList = { id: string; name: string; tasks: string[] }

export const LISTS: TaskList[] = [
  {
    id: 'morning',
    name: 'Start the day',
    tasks: ['Review what arrived overnight', 'Write the first note', 'Clear one blocker'],
  },
  {
    id: 'follow',
    name: 'Follow up',
    tasks: ['Call back', 'Send the note', 'Confirm the time'],
  },
  {
    id: 'close',
    name: 'Close the day',
    tasks: ['Mark what is done', 'Move what is left', 'Write tomorrow\'s first task'],
  },
]

export function listByName(input: string): TaskList | null {
  const text = input.trim().toLowerCase()
  return LISTS.find((list) => list.name.toLowerCase() === text || list.id === text) ?? null
}
