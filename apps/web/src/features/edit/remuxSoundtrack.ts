import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
} from 'mediabunny'
import { MUSIC_GAIN } from './soundtrack'

const RATE = 48000
const WEBM_VIDEO = new Set(['vp8', 'vp9', 'av1'])

/**
 * The take with a soundtrack: the video packets are copied unchanged (never decoded
 * or re-encoded); the voice and the looping music are mixed once, faster than real
 * time, and encoded as the file's only audio track. Length = the video's own length.
 */
export async function remuxWithSoundtrack(video: Blob, music: AudioBuffer): Promise<{ file: Blob; durationMs: number }> {
  const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    const codec = track?.codec
    const decoderConfig = await track?.getDecoderConfig()
    if (!track || !codec || !decoderConfig) throw new Error('Could not read the video')
    const start = await track.getFirstTimestamp()
    const seconds = (await track.computeDuration()) - start
    if (!(seconds > 0)) throw new Error('Could not read the video')

    const mixed = await mix(await input.getPrimaryAudioTrack(), music, seconds, start)

    // Same container family as the video codec, so its packets can be copied as-is.
    const webm = WEBM_VIDEO.has(codec)
    const format = webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' })
    const audioCodec: AudioCodec = !webm && (await canEncodeAudio('aac')) ? 'aac' : 'opus'
    if (!(await canEncodeAudio(audioCodec))) throw new Error('This browser cannot encode the soundtrack')

    const target = new BufferTarget()
    const output = new Output({ format, target })
    const videoOut = new EncodedVideoPacketSource(codec)
    const audioOut = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH })
    output.addVideoTrack(videoOut, { rotation: track.rotation })
    output.addAudioTrack(audioOut)
    await output.start()

    const copyVideo = async () => {
      let first = true
      for await (const packet of new EncodedPacketSink(track).packets()) {
        // Rebase so video and the new audio both start at 0.
        await videoOut.add(packet.clone({ timestamp: packet.timestamp - start }), first ? { decoderConfig } : undefined)
        first = false
      }
      videoOut.close()
    }
    const writeAudio = async () => {
      await audioOut.add(mixed)
      audioOut.close()
    }
    await Promise.all([copyVideo(), writeAudio()])
    await output.finalize()
    if (!target.buffer) throw new Error('Could not save the clip')
    return { file: new Blob([target.buffer], { type: format.mimeType }), durationMs: Math.round(seconds * 1000) }
  } finally {
    input.dispose()
  }
}

// Voice (if the take has any) at full level + music looped under it, cut to the video.
async function mix(voiceTrack: Awaited<ReturnType<Input['getPrimaryAudioTrack']>>, music: AudioBuffer, seconds: number, start: number) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE)
  if (voiceTrack) {
    for await (const { buffer, timestamp } of new AudioBufferSink(voiceTrack).buffers()) {
      const at = timestamp - start
      if (at >= seconds) break
      const node = ctx.createBufferSource()
      node.buffer = buffer
      node.connect(ctx.destination)
      if (at >= 0) node.start(at)
      else node.start(0, -at)
    }
  }
  const bed = ctx.createBufferSource()
  bed.buffer = music
  bed.loop = true
  const gain = ctx.createGain()
  gain.gain.value = MUSIC_GAIN
  bed.connect(gain).connect(ctx.destination)
  bed.start(0)
  return ctx.startRendering()
}
