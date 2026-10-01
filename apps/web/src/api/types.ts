export type MediaType = 'audio' | 'video' | 'image' | 'file'
export type ReactionType = 'like' | 'ack' | 'laugh'

export type Author = {
  id: string
  name: string
}

export type Media = {
  id: string
  type: MediaType
  url: string
  duration?: number
  poster?: string
  name?: string
  mimeType?: string
  size?: number
  source?: 'stored' | 'youtube' // youtube = external video, referenced not stored
  externalId?: string // canonical YouTube video id
  title?: string // external title
  embeddable?: boolean // false → link card (no inline playback, no anchors)
}

export type Reaction = {
  type: ReactionType
  count: number
  reacted?: boolean // whether the current user has this reaction
}

export type Item = {
  id: string
  messageId: string
  number: number
  parentId?: string
  anchorStartMs?: number // moment (ms) in the parent's media this reply anchors to
  author: Author
  text?: string
  media?: Media[]
  reactions: Reaction[]
  createdAt: string
}

// A capture or file chosen in the UI but not uploaded yet. Room.send uploads it
// (SDK uploadMedia) and attaches the returned id.
export type LocalMedia = {
  file: Blob
  type: MediaType
  name?: string
  duration?: number // SECONDS — the API contract unit (convert from ms at the source)
}

// A YouTube link pasted in the composer, resolved by its preview player but not yet
// registered with the server (createYouTubeMedia does that at Send).
export type YouTubeDraft = {
  kind: 'youtube'
  url: string
  durationMs?: number // measured by the preview player
  embeddable: boolean
}

// What the Instrument hands to Room.send. Reply context comes from UI state.
export type SendInput = {
  text?: string
  media?: Array<Media | LocalMedia | YouTubeDraft>
}

export const isYouTubeDraft = (m: Media | LocalMedia | YouTubeDraft): m is YouTubeDraft => 'kind' in m && m.kind === 'youtube'

export const isLocalMedia = (m: Media | LocalMedia | YouTubeDraft): m is LocalMedia => 'file' in m && m.file instanceof Blob
