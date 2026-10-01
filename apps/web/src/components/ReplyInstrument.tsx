import React, { useState } from 'react';

type ReplyInstrumentProps = {
  isActive: boolean;
  targetId?: string;
  targetTimestamp?: string;
  onCancel: () => void;
  onSend: () => void;
};

export function ReplyInstrument({
  isActive,
  targetId,
  targetTimestamp,
  onCancel,
  onSend,
}: ReplyInstrumentProps) {
  // Hardcoded UI state for now to match the user's "daydream" layout
  const [mode, setMode] = useState<'video' | 'audio' | 'text'>('video');

  return (
    <div className={`reply-instrument ${isActive ? 'is-active' : ''}`}>
      <div className="reply-instrument-header">
        {targetId && targetTimestamp ? `RE:${targetId} · ${targetTimestamp}` : 'REPLY'}
      </div>
      
      <div className="reply-instrument-body">
        {/* Placeholder for the camera preview */}
        {mode === 'video' && (
          <div className="cam-preview" style={{ width: '100%', aspectRatio: '4/3', borderRadius: '2px' }}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#555', fontSize: '11px', fontFamily: 'var(--mono)' }}>CAMERA OFF</div>
          </div>
        )}

        {/* Placeholder for audio meter */}
        {mode === 'audio' && (
          <div style={{ width: '100%', height: '40px', background: 'var(--line)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
             <div style={{ width: '60%', height: '4px', background: 'var(--signal)', opacity: 0.5 }}></div>
          </div>
        )}

        {/* Placeholder for text input */}
        {mode === 'text' && (
          <textarea 
            placeholder="Type your reply..." 
            style={{ width: '100%', height: '120px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '12px', resize: 'none', outline: 'none' }} 
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: 'auto', marginBottom: 'auto' }}>
           {/* The REC button matching the record button style */}
           <button className="record-button" data-mass="rest" aria-label="Record">
             ●
           </button>
           <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--signal)' }}>00:00</span>
        </div>

        {/* Mode Switcher */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)', marginTop: 'auto' }}>
          <button style={{ color: mode === 'audio' ? 'var(--ink)' : 'inherit' }} onClick={() => setMode('audio')}>AUDIO</button>
          <button style={{ color: mode === 'video' ? 'var(--ink)' : 'inherit' }} onClick={() => setMode('video')}>VIDEO</button>
          <button style={{ color: mode === 'text' ? 'var(--ink)' : 'inherit' }} onClick={() => setMode('text')}>Aa</button>
        </div>
      </div>

      <div className="reply-instrument-footer">
        <button onClick={onCancel} style={{ fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.08em', color: 'var(--muted)' }}>CANCEL</button>
        <button onClick={onSend} style={{ fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.08em', color: 'var(--ink)' }}>SEND</button>
      </div>
    </div>
  );
}
