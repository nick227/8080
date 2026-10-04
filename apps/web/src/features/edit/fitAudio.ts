export async function decodeStock(url: string): Promise<AudioBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load that track')
  const bytes = await response.arrayBuffer()
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(bytes.slice(0))
  } finally {
    await ctx.close()
  }
}

export function bufferDurationMs(buffer: AudioBuffer): number {
  return Math.round((buffer.length / buffer.sampleRate) * 1000)
}

export function waveformPeaks(buffer: AudioBuffer, points = 50): number[] {
  const data = buffer.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / points))
  const stride = Math.max(1, Math.floor(step / 100))
  const peaks: number[] = []
  for (let i = 0; i < points; i++) {
    let sum = 0
    let count = 0
    for (let j = 0; j < step; j += stride) {
      const sample = data[i * step + j] ?? 0
      sum += sample < 0 ? -sample : sample
      count++
    }
    peaks.push(sum / Math.max(1, count))
  }
  const max = Math.max(...peaks, 0.001)
  return peaks.map(peak => peak / max)
}

export function readDurationMs(url: string, kind: 'audio' | 'video'): Promise<number> {
  const el = document.createElement(kind)
  el.preload = 'metadata'
  el.src = url
  return new Promise((resolve, reject) => {
    el.onloadedmetadata = () => {
      const ms = Math.round(el.duration * 1000)
      el.src = ''
      resolve(ms)
    }
    el.onerror = () => reject(new Error('Could not read the take'))
  })
}
