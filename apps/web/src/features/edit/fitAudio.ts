export async function decodeStock(url: string): Promise<AudioBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load that track')
  const bytes = await response.arrayBuffer()
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(bytes)
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
  let max = 0.001
  for (let i = 0; i < points; i++) {
    let sum = 0
    let count = 0
    for (let j = 0; j < step; j += stride) {
      const sample = data[i * step + j] ?? 0
      sum += sample < 0 ? -sample : sample
      count++
    }
    const peak = sum / Math.max(1, count)
    peaks.push(peak)
    max = Math.max(max, peak)
  }
  for (let i = 0; i < peaks.length; i++) peaks[i] /= max
  return peaks
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
