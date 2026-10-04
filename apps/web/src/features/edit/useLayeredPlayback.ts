import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PlayableMediaController, PlayOutcome } from '../../media/controller'
import { primePreviewAudio, stopStockPreview } from './previewAudio'
import { MUSIC_GAIN } from './soundtrack'

type Listener = () => void

// Max music/video disagreement before the music is re-cued to the picture.
const DRIFT_S = 0.08

/**
 * Soundtrack preview for a video take: nothing is rendered. The <video> plays as-is
 * (voice included) and is the only clock; the music loops under it, cued to
 * video.currentTime on every play/seek and re-cued if it drifts. Save produces the
 * same mix (remuxSoundtrack.ts), so what plays here is what gets posted.
 */
export function useLayeredPlayback(
  music: AudioBuffer,
  durationMs: number,
  videoRef: RefObject<HTMLVideoElement | null>,
  onPlaying?: (playing: boolean) => void,
) {
  const [progress, setProgress] = useState(0)
  const musicRef = useRef(music)
  const durationRef = useRef(durationMs)
  const onPlayingRef = useRef(onPlaying)
  const listeners = useRef(new Set<Listener>())
  const apiRef = useRef<PlayableMediaController | null>(null)
  musicRef.current = music
  durationRef.current = durationMs
  onPlayingRef.current = onPlaying

  const lengthS = () => {
    const d = videoRef.current?.duration
    return d && Number.isFinite(d) ? d : durationRef.current / 1000
  }

  if (!apiRef.current) {
    apiRef.current = {
      kind: 'html',
      play: async (): Promise<PlayOutcome> => {
        const video = videoRef.current
        if (!video) return 'unplayable'
        stopStockPreview()
        if (video.ended || video.currentTime >= lengthS() - 0.03) video.currentTime = 0
        try {
          await video.play()
          return 'playing'
        } catch (err) {
          return err instanceof DOMException && err.name === 'NotAllowedError' ? 'blocked' : 'unplayable'
        }
      },
      pause: () => videoRef.current?.pause(),
      seek: (ms) => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, ms / 1000) },
      getCurrentTimeMs: () => (videoRef.current?.currentTime ?? 0) * 1000,
      getDurationMs: () => lengthS() * 1000,
      onEnded: (cb) => {
        listeners.current.add(cb)
        return () => listeners.current.delete(cb)
      },
    }
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const ctx = primePreviewAudio()
    const gain = ctx.createGain()
    gain.gain.value = MUSIC_GAIN
    gain.connect(ctx.destination)
    let source: AudioBufferSourceNode | null = null
    let cuedAt = 0 // ctx time when the music was cued
    let cuedFrom = 0 // video time it was cued to
    let raf = 0

    const stopMusic = () => {
      try { source?.stop() } catch { /* already stopped */ }
      source?.disconnect()
      source = null
    }
    const cueMusic = () => {
      stopMusic()
      if (video.paused) return
      const buffer = musicRef.current
      source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(gain)
      cuedAt = ctx.currentTime
      cuedFrom = video.currentTime
      source.start(0, video.currentTime % buffer.duration)
    }
    const tick = () => {
      setProgress(Math.min(1, video.currentTime / lengthS()))
      if (source && Math.abs(cuedFrom + (ctx.currentTime - cuedAt) - video.currentTime) > DRIFT_S) cueMusic()
      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      void ctx.resume().then(cueMusic)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
      onPlayingRef.current?.(true)
    }
    const onHalt = () => stopMusic()
    const onPause = () => {
      stopMusic()
      cancelAnimationFrame(raf)
      setProgress(Math.min(1, video.currentTime / lengthS()))
      onPlayingRef.current?.(false)
    }
    const onSeeked = () => { if (!video.paused) cueMusic() }
    const onEnded = () => {
      onPause()
      setProgress(1)
      listeners.current.forEach((cb) => cb())
    }

    video.muted = false
    video.addEventListener('playing', onPlay)
    video.addEventListener('waiting', onHalt)
    video.addEventListener('seeking', onHalt)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)

    // Applying a track starts the preview from the top.
    video.currentTime = 0
    setProgress(0)
    const start = requestAnimationFrame(() => {
      void video.play().catch(() => {
        // No user activation for sound: play the picture muted rather than not at all.
        video.muted = true
        void video.play().catch(() => undefined)
      })
    })

    return () => {
      cancelAnimationFrame(start)
      cancelAnimationFrame(raf)
      video.removeEventListener('playing', onPlay)
      video.removeEventListener('waiting', onHalt)
      video.removeEventListener('seeking', onHalt)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      stopMusic()
      gain.disconnect()
      video.pause()
      onPlayingRef.current?.(false)
    }
  }, [music, videoRef])

  return { progress, api: apiRef.current }
}
