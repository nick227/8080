let previewCtx: AudioContext | null = null

// Resumed in the click that picks a track, so playback can start after the file decodes.
export function primePreviewAudio(): AudioContext {
  if (!previewCtx || previewCtx.state === 'closed') previewCtx = new AudioContext()
  void previewCtx.resume()
  return previewCtx
}
