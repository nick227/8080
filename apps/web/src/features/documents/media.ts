const urls = new Map<string, string>()

export function mediaUrl(blockId: string) {
  return urls.get(blockId)
}

export function setMediaFile(blockId: string, file: File) {
  const prev = urls.get(blockId)
  if (prev) URL.revokeObjectURL(prev)
  const url = URL.createObjectURL(file)
  urls.set(blockId, url)
  return url
}

export function mediaKind(file: File): 'image' | 'video' | 'audio' | 'file' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}
