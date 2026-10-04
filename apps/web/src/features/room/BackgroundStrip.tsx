import { useRef } from 'react'
import { useBackground } from '../../state/background'
import { STOCK_IMAGES } from '../edit/stock'
import { THUMB_ACCEPT, thumbFileProblem } from '../conversation/newConversation'
import { useUI } from '../../state/ui'
import { useMaskUpgrade } from '../vbg/maskSource'

// Camera background, chosen while framing (it's baked in while recording):
// ORIGINAL · BLUR · [photos] · +. The user's own photo is kept in the browser.
export function BackgroundStrip() {
  const fileRef = useRef<HTMLInputElement>(null)
  const mode = useBackground((s) => s.mode)
  const photo = useBackground((s) => s.photo)
  const mine = useBackground((s) => s.mine)
  const status = useBackground((s) => s.status)
  const message = useBackground((s) => s.message)
  const choose = useBackground((s) => s.choose)
  const uploadMine = useBackground((s) => s.uploadMine)
  const photos = mine ? [...STOCK_IMAGES, { id: mine.id, name: 'Yours', url: mine.url }] : STOCK_IMAGES
  const upgrade = useMaskUpgrade()
  // MediaPipe is ready at once; MODNet's sharper edges arrive when its download finishes.
  const note = mode !== 'original' && status === 'loading' ? 'Loading background…'
    : mode !== 'original' && upgrade.state === 'loading' ? `Sharper edges loading… ${upgrade.pct}%`
    : status === 'unavailable' ? (message ?? 'Background unavailable') + ' — using original'
    : null

  return (
    <div className="bg-strip" role="group" aria-label="Background">
      <div className="bg-strip-row">
        <button type="button" className="bg-chip" aria-pressed={mode === 'original'} onClick={() => choose('original')}>Original</button>
        <button type="button" className="bg-chip" aria-pressed={mode === 'blur'} onClick={() => choose('blur')}>Blur</button>
        {photos.map((image) => (
          <button key={image.id} type="button" className="bg-thumb" aria-label={`Background: ${image.name}`} aria-pressed={mode === 'photo' && photo?.id === image.id}
            onClick={() => choose('photo', { id: image.id, url: image.url })}>
            <img src={image.url} alt="" />
          </button>
        ))}
        <button type="button" className="bg-chip" aria-label="Your own background photo" onClick={() => fileRef.current?.click()}>+</button>
        <input ref={fileRef} type="file" accept={THUMB_ACCEPT} hidden onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          const problem = thumbFileProblem(file)
          if (problem) { useUI.getState().setError(problem); return }
          uploadMine(file)
        }} />
      </div>
      {note && <p className="bg-strip-note" role="status">{note}</p>}
    </div>
  )
}
