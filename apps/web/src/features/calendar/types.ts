export type CalTask = {
  id: string
  title: string
  day: string
  time: string | null
  status: 'open' | 'done'
  source: string | null
}
