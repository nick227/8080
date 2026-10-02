import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PlayableMediaController, PlayOutcome } from '../../media/controller'
import { primePreviewAudio } from './previewAudio'

type Listener = () => void

export function useFittedPlayback(
  buffer: AudioBuffer,
  durationMs: number,
  videoRef: RefObject<HTMLVideoElement | null>,
  onPlaying?: (playing: boolean) => void,
) {
  const [progress, setProgress] = useState(0)
  const bufferRef = useRef(buffer)
  const durationRef = useRef(durationMs)
  const onPlayingRef = useRef(onPlaying)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const originRef = useRef(0)
  const offsetRef = useRef(0)
  const playingRef = useRef(false)
  const rafRef = useRef(0)
  const listenersRef = useRef(new Set<Listener>())
  const playRef = useRef<() => Promise<PlayOutcome>>(async () => 'unplayable')
  const pauseRef = useRef<() => void>(() => {})
  const seekRef = useRef<(ms: number) => void>(() => {})
  const timeRef = useRef<() => number>(() => 0)
  const apiRef = useRef<PlayableMediaController | null>(null)

  bufferRef.current = buffer
  durationRef.current = durationMs
  onPlayingRef.current = onPlaying

  const endingRef = useRef(false)

  const stopSource = () => {
    const source = sourceRef.current
    sourceRef.current = null
    try { source?.stop() } catch { /* already ended */ }
    cancelAnimationFrame(rafRef.current)
  }

  const setPlay = (on: boolean) => {
    playingRef.current = on
    onPlayingRef.current?.(on)
  }

  const finish = () => {
    if (endingRef.current) return
    endingRef.current = true
    stopSource()
    videoRef.current?.pause()
    offsetRef.current = 0
    setProgress(1)
    setPlay(false)
    listenersRef.current.forEach(cb => cb())
  }

  pauseRef.current = () => {
    if (!playingRef.current) return
    offsetRef.current = Math.min(durationRef.current, Math.max(0, performance.now() - originRef.current))
    stopSource()
    videoRef.current?.pause()
    setPlay(false)
  }

  timeRef.current = () => playingRef.current
    ? Math.min(durationRef.current, Math.max(0, performance.now() - originRef.current))
    : offsetRef.current

  playRef.current = async () => {
    if (offsetRef.current >= durationRef.current - 30) offsetRef.current = 0
    const ctx = primePreviewAudio()
    ctxRef.current = ctx
    try {
      if (ctx.state === 'suspended') await ctx.resume()
    } catch (err) {
      return err instanceof DOMException && err.name === 'NotAllowedError' ? 'blocked' : 'unplayable'
    }
    stopSource()
    endingRef.current = false
    const source = ctx.createBufferSource()
    source.buffer = bufferRef.current
    source.connect(ctx.destination)
    const offsetSec = offsetRef.current / 1000
    source.onended = () => { if (sourceRef.current === source) finish() }
    sourceRef.current = source
    const video = videoRef.current
    if (video) {
      video.muted = true
      if (Math.abs(video.currentTime - offsetSec) > 0.05) video.currentTime = offsetSec
    }
    source.start(0, offsetSec)
    originRef.current = performance.now() - offsetRef.current
    setProgress(offsetRef.current / durationRef.current)
    setPlay(true)
    const tick = () => {
      const ms = performance.now() - originRef.current
      setProgress(Math.min(1, ms / durationRef.current))
      if (ms >= durationRef.current) finish()
      else rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    if (video) {
      try { await video.play() } catch { /* picture holds; the track still plays */ }
    }
    return 'playing'
  }

  seekRef.current = (ms: number) => {
    const was = playingRef.current
    pauseRef.current()
    offsetRef.current = Math.min(durationRef.current, Math.max(0, ms))
    setProgress(offsetRef.current / Math.max(1, durationRef.current))
    if (was) void playRef.current()
  }

  if (!apiRef.current) {
    apiRef.current = {
      kind: 'html',
      play: () => playRef.current(),
      pause: () => pauseRef.current(),
      seek: ms => seekRef.current(ms),
      getCurrentTimeMs: () => timeRef.current(),
      getDurationMs: () => durationRef.current,
      onEnded: cb => {
        listenersRef.current.add(cb)
        return () => listenersRef.current.delete(cb)
      },
    }
  }

  useEffect(() => {
    offsetRef.current = 0
    setProgress(0)
    endingRef.current = false
    const frame = requestAnimationFrame(() => { void playRef.current() })
    return () => {
      cancelAnimationFrame(frame)
      stopSource()
      videoRef.current?.pause()
      playingRef.current = false
      onPlayingRef.current?.(false)
    }
  }, [buffer, videoRef])

  return { progress, api: apiRef.current }
}
