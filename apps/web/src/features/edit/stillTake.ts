import type { LocalMedia } from '../../api/types'
import { decodeStock, readDurationMs, waveformPeaks } from './fitAudio'
import type { FittedTake, TakePicture } from './useStockEdit'

export async function imageFile(url: string, id: string): Promise<LocalMedia> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load that image')
  const blob = await response.blob()
  const type = blob.type.startsWith('image/') ? blob.type : 'image/jpeg'
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
  const name = `${id}.${ext}`
  return { file: new File([blob], name, { type }), type: 'image', name }
}

export async function stillTake(
  current: TakePicture,
  imageUrl: string,
  token: number,
  request: { current: number },
): Promise<Omit<FittedTake, 'trackId'> | null> {
  await loadStill(imageUrl)
  if (token !== request.current) return null
  if (current.kind === 'text') return { buffer: null, durationMs: 0, waveform: [], imageUrl }
  if (current.kind !== 'audio') return null
  const durationMs = current.durationMs > 0 ? current.durationMs : await readDurationMs(current.url, 'audio')
  if (token !== request.current) return null
  const buffer = await decodeStock(current.url)
  if (token !== request.current) return null
  return { buffer, durationMs, waveform: waveformPeaks(buffer), imageUrl }
}

function loadStill(url: string) {
  const img = new Image()
  img.src = url
  return img.decode().catch(() => { throw new Error('Could not load that image') })
}
