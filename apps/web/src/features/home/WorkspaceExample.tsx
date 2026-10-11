import { useRef, useState } from 'react'

const tabs = ['Contact', 'Document', 'Conversation'] as const
export function WorkspaceExample() {
  const [selected, setSelected] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const select = (index: number) => { setSelected(index); buttons.current[index]?.focus() }
  return <div className="product-example">
    <header><p className="product-caption">Example workspace · Fictional data</p><h3>Fieldwork Studio</h3></header>
    <div className="product-example-tabs" role="tablist" aria-label="Example workspace">
      {tabs.map((tab, index) => <button key={tab} ref={(el) => { buttons.current[index] = el }} type="button" role="tab" id={`example-tab-${index}`} aria-controls="example-panel" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
        if (next !== null) { event.preventDefault(); select(next) }
      }}>{tab}</button>)}
    </div>
    <div className="product-example-panel" id="example-panel" role="tabpanel" aria-labelledby={`example-tab-${selected}`} tabIndex={0}>
      {selected === 0 && <><p className="product-caption">Contact</p><h4>Northline Café</h4><dl><div><dt>Contact person</dt><dd>Alex Morgan</dd></div><div><dt>Next step</dt><dd>Review the launch proposal</dd></div></dl><p className="product-caption">Related items</p><button onClick={() => select(1)}>Northline launch proposal <span aria-hidden>→</span></button><button onClick={() => select(2)}>Launch proposal review <span aria-hidden>→</span></button><p className="product-example-note">A contact can link to documents and conversations.</p></>}
      {selected === 1 && <><p className="product-caption">Document</p><h4>Northline launch proposal</h4><p>Prepare the café menu, update the website, and photograph the new space before opening day.</p><h5>For review</h5><p>Confirm the menu and photography date with Alex.</p><button onClick={() => select(2)}>Open proposal conversation <span aria-hidden>→</span></button><button onClick={() => select(0)}>Open Northline Café contact <span aria-hidden>→</span></button><p className="product-example-note">A document can link to a conversation about its contents.</p></>}
      {selected === 2 && <><p className="product-caption">Conversation</p><h4>Launch proposal review</h4><div className="product-example-message"><strong>Sam</strong><p>The proposal is ready. Can you confirm the photography date with Alex?</p></div><div className="product-example-message"><strong>Jo</strong><p>I'll ask Alex and add the date to the proposal.</p></div><button onClick={() => select(1)}>Open Northline launch proposal <span aria-hidden>→</span></button><button onClick={() => select(0)}>Open Northline Café contact <span aria-hidden>→</span></button><p className="product-example-note">Return to the document or contact from the conversation.</p></>}
    </div>
  </div>
}
