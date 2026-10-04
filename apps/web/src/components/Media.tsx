import React, { useState, MediaHTMLAttributes } from 'react';
import { AnchorRail } from './AnchorRail';
import { YouTubeMedia } from './YouTubeMedia';
import { parseYouTubeVideoId } from '@project/shared';
import { htmlMediaController, registerController } from '../media/controller';
import type { Anchor } from '../utils/anchor';

interface MediaProps extends MediaHTMLAttributes<HTMLMediaElement> {
  type?: 'audio' | 'video' | 'image' | 'file';
  preview?: boolean;
  name?: string;
  poster?: string;
  aspectRatio?: number;
  isActive?: boolean;
  isUpcoming?: boolean;
  onEnded?: () => void;
  onPlayStatusChange?: (playing: boolean) => void;
  // Feed items route play through UI state (highlight, auto-advance, follow-replies)
  // instead of playing the element directly.
  onRequestPlay?: () => void;
  waveform?: number[] | null;
  // Conversation rows put Play/Pause next to Reply, so the waveform uses the whole row.
  hidePlayButton?: boolean;
  // Anchored replies on this media (V1: only the parent's single timed clip).
  anchors?: Anchor[];
  anchorDurationMs?: number;
  activeAnchorId?: string;
  onAnchorSelect?: (ids: string[], ms: number) => void;
  // External (YouTube) metadata; ignored for stored media.
  title?: string;
  embeddable?: boolean;
}

// Every media source behind one component. A video whose URL is a YouTube link plays
// through the YouTube adapter; everything else is our stored <audio>/<video>/<img>.
// Callers don't change.
export function Media(props: MediaProps) {
  const ytId = props.type === 'video' && typeof props.src === 'string' ? parseYouTubeVideoId(props.src) : null
  if (ytId) {
    return (
      <YouTubeMedia
        videoId={ytId}
        title={props.title ?? props.name}
        embeddable={props.embeddable}
        isActive={props.isActive}
        isUpcoming={props.isUpcoming}
        onEnded={props.onEnded}
        onRequestPlay={props.onRequestPlay}
        anchors={props.anchors}
        anchorDurationMs={props.anchorDurationMs}
        activeAnchorId={props.activeAnchorId}
        onAnchorSelect={props.onAnchorSelect}
      />
    );
  }
  return <StoredMedia {...props} />;
}

// One WebAudio graph per media element: an element can be connected to a
// MediaElementSourceNode only once, ever. React StrictMode (and fast remounts)
// unmount→remount on the same DOM node, so graphs are reused, and releasing is
// deferred a tick so a remount can cancel it. Real unmounts disconnect the graph.
//
// All graphs share ONE AudioContext. A context per element piled up one live audio
// thread per clip played (continuous playback through 100 clips = 100 contexts);
// iOS Safari caps contexts at a handful. The shared context is never closed.
type SpatialGraph = { ctx: AudioContext; source: MediaElementAudioSourceNode; panner: StereoPannerNode; releaseTimer?: ReturnType<typeof setTimeout> }
const graphs = new WeakMap<HTMLMediaElement, SpatialGraph>()
let sharedContext: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (sharedContext) return sharedContext
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  return Ctx ? (sharedContext = new Ctx() as AudioContext) : null
}

function attachGraph(el: HTMLMediaElement): SpatialGraph | null {
  const existing = graphs.get(el)
  if (existing) {
    clearTimeout(existing.releaseTimer)
    return existing
  }
  const ctx = audioContext()
  if (!ctx) return null
  const source = ctx.createMediaElementSource(el)
  const panner = ctx.createStereoPanner()
  source.connect(panner)
  panner.connect(ctx.destination)
  const graph = { ctx, source, panner }
  graphs.set(el, graph)
  return graph
}

// Starting playback can fail. A browser autoplay block (NotAllowedError) needs a
// tap — keep the item active and say so. Anything else (bad/missing file) can never
// play, so treat it as ended and let continuous playback move on.
// AbortError = a pause/src change interrupted the request; not a failure.
export function startPlaying(el: HTMLMediaElement, onBlocked: () => void, onUnplayable: () => void) {
  el.play().catch((err: unknown) => {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'AbortError') return
    if (name === 'NotAllowedError') onBlocked()
    else onUnplayable()
  })
}

function releaseGraph(el: HTMLMediaElement) {
  const graph = graphs.get(el)
  if (!graph) return
  graph.releaseTimer = setTimeout(() => {
    graphs.delete(el)
    graph.source.disconnect()
    graph.panner.disconnect()
  }, 0)
}

function StoredMedia({ type = 'image', preview = false, name, poster, src, aspectRatio, className = '', isActive, isUpcoming, onEnded, onPlayStatusChange, onRequestPlay, waveform, hidePlayButton, anchors, anchorDurationMs, activeAnchorId, onAnchorSelect, title: _title, embeddable: _embeddable, ...props }: MediaProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const mediaRef = React.useRef<HTMLMediaElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const onEndedRef = React.useRef(onEnded);
  onEndedRef.current = onEnded;
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const pannerRef = React.useRef<StereoPannerNode | null>(null);

  React.useEffect(() => {
    if (isActive && mediaRef.current) {
      // Spatial audio graph, created lazily on first play and reused per element
      if (type === 'audio' && !audioCtxRef.current) {
        const graph = attachGraph(mediaRef.current);
        audioCtxRef.current = graph?.ctx ?? null;
        pannerRef.current = graph?.panner ?? null;
      }
      if (error) onEndedRef.current?.(); // already known broken: skip immediately
      else startPlaying(mediaRef.current, () => setBlocked(true), () => onEndedRef.current?.());
    } else if (!isActive && mediaRef.current) {
      mediaRef.current.pause();
      setBlocked(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, type]);

  // One playback contract for every source (see media/controller.ts).
  React.useEffect(() => {
    const el = mediaRef.current;
    return el ? registerController(el, htmlMediaController(el)) : undefined;
  }, []);

  React.useEffect(() => {
    const el = mediaRef.current;
    return () => {
      if (el) releaseGraph(el);
      audioCtxRef.current = null;
      pannerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    let animFrame: number;
    const updatePan = () => {
      if (playing && pannerRef.current && mediaRef.current) {
        const rect = mediaRef.current.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        // Calculate pan from -1 (left) to 1 (right)
        const pan = (center / window.innerWidth) * 2 - 1;
        pannerRef.current.pan.value = Math.max(-1, Math.min(1, pan));
        animFrame = requestAnimationFrame(updatePan);
      }
    };
    if (playing) {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      animFrame = requestAnimationFrame(updatePan);
    }
    return () => cancelAnimationFrame(animFrame);
  }, [playing]);

  const rail = null;

  const baseClass = preview ? 'media-container preview' : 'media-container';
  const finalClass = `${baseClass} ${className}`.trim();
  
  if (type === 'audio') {
    return (
      <div className={`media-view loaded audio-waveform ${playing ? 'playing' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <audio 
          ref={mediaRef as React.RefObject<HTMLAudioElement>} 
          src={src} 
          // Required: the spatial panner routes this element through WebAudio, which
          // outputs silence for cross-origin media unless it was fetched with CORS.
          crossOrigin="anonymous"
          preload={isUpcoming || isActive ? "auto" : "metadata"} 
          onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration || 0)}
          onEnded={onEnded} 
          onPlay={() => { setPlaying(true); setBlocked(false); onPlayStatusChange?.(true); }}
          onPause={() => { setPlaying(false); onPlayStatusChange?.(false); }}
          onTimeUpdate={(e) => setProgress((e.target as HTMLAudioElement).currentTime / ((e.target as HTMLAudioElement).duration || 1))}
          onError={() => { setError(true); if (onEnded && isActive) onEnded(); }} 
          {...props} 
        />
        {waveform ? (
          <div style={{ display: 'flex', gap: hidePlayButton ? 0 : 16, alignItems: 'center', width: '100%', padding: hidePlayButton ? 0 : '0 16px' }}>
            {!hidePlayButton && (
              <button
                type="button"
                className="lobby-pill"
                aria-label={playing ? 'Pause' : 'Play'}
                style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, background: 'var(--surface-sunken)' }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isActive && mediaRef.current?.paused) return void mediaRef.current.play().catch(() => {})
                  if (onRequestPlay && !isActive) return onRequestPlay()
                  const el = mediaRef.current
                  if (!el) return
                  if (el.paused) el.play().catch(() => {})
                  else el.pause()
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>
            )}
            <div
              style={{ display: 'flex', gap: hidePlayButton ? 2 : 4, height: 64, alignItems: 'center', flex: 1, width: '100%', cursor: 'pointer', position: 'relative' }}
            onClick={(e) => {
              if (isActive && mediaRef.current?.paused) return void mediaRef.current.play().catch(() => {})
              if (onRequestPlay && !isActive) return onRequestPlay()
              const rect = e.currentTarget.getBoundingClientRect()
              const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              if (mediaRef.current) {
                mediaRef.current.currentTime = pos * mediaRef.current.duration
                if (mediaRef.current.paused) mediaRef.current.play().catch(() => {})
              }
            }}
          >
            {waveform.map((val, i) => (
              <div 
                key={i} 
                style={{
                  width: hidePlayButton ? undefined : 4,
                  flex: hidePlayButton ? '1 1 0' : undefined,
                  minWidth: hidePlayButton ? 0 : undefined,
                  height: `${Math.max(10, val * 100)}%`,
                  background: (i / waveform.length) <= progress ? 'var(--signal)' : 'var(--ink)',
                  borderRadius: 2,
                  transition: 'background 0.1s linear'
                }} 
              />
            ))}
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label={playing ? 'Pause audio' : 'Play audio'}
            onClick={() => {
              // Active but paused (blocked autoplay / OS interruption): resume in place
              // rather than toggling playback off.
              if (isActive && mediaRef.current?.paused) return void mediaRef.current.play().catch(() => {})
              if (onRequestPlay) return onRequestPlay()
              const el = mediaRef.current
              if (!el) return
              if (el.paused) el.play().catch(() => {})
              else el.pause()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.currentTarget.click()
              }
            }}
            style={{ height: 40, width: '100%', background: 'var(--bg-elevated)', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
          >
            <div aria-hidden style={{ position: 'absolute', inset: 0, width: `${progress * 100}%`, background: 'var(--signal)', opacity: 0.25, transition: 'width 0.25s linear' }} />
            {!hidePlayButton && <span aria-hidden style={{ position: 'relative' }}>{playing ? '❚❚' : '▶'}</span>}
            <span style={{ position: 'relative', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em' }}>
              {error ? 'UNAVAILABLE' : blocked ? 'TAP TO CONTINUE' : duration ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : 'AUDIO'}
            </span>
          </div>
        )}
        {rail}
      </div>
    );
  }
  
  if (type === 'file') {
    return <a className="media-view file loaded" href={src} download={name}>{name ?? 'FILE'}</a>;
  }

  const style = aspectRatio ? { paddingBottom: `${(1 / aspectRatio) * 100}%` } : undefined;

  return (
    <>
    <div className={finalClass} style={style}>
      {!loaded && !error && <div className="media-skeleton" />}
      {error && <div className="media-error">FAILED TO LOAD</div>}
      
      {type === 'video' && (
        <CustomVideo 
          src={src as string}
          poster={poster}
          isActive={isActive}
          isUpcoming={isUpcoming}
          onLoadedData={() => setLoaded(true)}
          onError={() => {
            setError(true)
            if (onEnded && isActive) onEnded()
          }}
          onEnded={onEnded}
          onPlayStatusChange={onPlayStatusChange}
          {...props}
        />
      )}
      
      {type === 'image' && (
        <img 
          className={`media-view ${loaded ? 'loaded' : ''}`}
          loading="lazy" 
          src={src} 
          alt={name ?? 'media'} 
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} 
        />
      )}
    </div>
    {type === 'video' && rail}
    </>
  );
}

type CustomVideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {
  src: string
  isActive?: boolean
  isUpcoming?: boolean
  onPlayStatusChange?: (playing: boolean) => void
}

function CustomVideo({ src, poster, isActive, isUpcoming, onLoadedData, onError, onEnded, onPlayStatusChange, ...props }: CustomVideoProps) {
  const ref = React.useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [showControls, setShowControls] = useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const onEndedRef = React.useRef(onEnded)
  onEndedRef.current = onEnded
  React.useEffect(() => {
    const el = ref.current
    return el ? registerController(el, htmlMediaController(el)) : undefined
  }, [])
  React.useEffect(() => {
    if (isActive && ref.current) {
      startPlaying(ref.current, () => wakeControls(), () => onEndedRef.current?.(undefined as never))
    } else if (!isActive && ref.current) {
      ref.current.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  const wakeControls = () => {
    setShowControls(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setShowControls(false), 1500)
  }

  return (
    <div 
      className="video-wrapper" 
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit' }} 
      onMouseMove={wakeControls} 
      onTouchStart={wakeControls}
    >
      <video
        ref={ref}
        src={src}
        poster={!playing ? poster : undefined}
        playsInline
        className="media-view loaded"
        preload={isUpcoming || isActive ? 'auto' : 'metadata'}
        onPlay={() => { setPlaying(true); onPlayStatusChange?.(true); }}
        onPause={() => { setPlaying(false); onPlayStatusChange?.(false); }}
        onTimeUpdate={(e) => {
          const t = e.target as HTMLVideoElement
          setProgress(t.currentTime / (t.duration || 1))
        }}
        onClick={() => {
          if (ref.current?.paused) ref.current?.play().catch(() => {})
          else ref.current?.pause()
          wakeControls()
        }}
        onEnded={onEnded}
        onLoadedData={onLoadedData}
        onError={onError}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        {...props}
      />
      <div 
        className="video-controls" 
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 48,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
          opacity: showControls ? 1 : 0, transition: 'opacity 0.3s ease',
          display: 'flex', alignItems: 'flex-end', padding: '0 12px 12px',
          pointerEvents: showControls ? 'auto' : 'none'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div 
          style={{ 
            width: '100%', height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer' 
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            if (ref.current) {
              ref.current.currentTime = pos * ref.current.duration
              if (ref.current.paused) ref.current.play().catch(() => {})
            }
          }}
        >
          <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.3)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: '#fff' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

