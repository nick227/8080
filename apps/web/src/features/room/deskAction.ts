export type DeskFrame = 'mic' | 'camera' | 'text' | 'file' | 'link'

export type MainAction = 'record' | 'stop' | 'submit'

// One button, three jobs. A capture is record, then stop. Once there is
// something to post — or the post was never a capture — the same button sends.
export function mainAction({ frame, recording, hasTake }: {
  frame: DeskFrame
  recording: boolean
  hasTake: boolean
}): MainAction {
  if (recording) return 'stop'
  if ((frame === 'mic' || frame === 'camera') && !hasTake) return 'record'
  return 'submit'
}
