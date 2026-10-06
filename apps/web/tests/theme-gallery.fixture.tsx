import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeSwitcher } from '../src/components/ThemeSwitcher'
import { initializeTheme, useTheme } from '../src/theme/store'
import { themes } from '../src/theme/registry'

initializeTheme()
function Gallery() {
  const id = useTheme(state => state.theme)
  const theme = themes.find(theme => theme.id === id)!
  return <>
    <header className="masthead">
      <button className="mast-icon" aria-label="Lobby">⌂</button>
      <p className="mast"><span className="mast-mark" />8080</p>
      <div className="mast-actions"><ThemeSwitcher /><button className="mast-icon" aria-label="Account">◎</button></div>
    </header>
    <main className="layout-page gallery-page" data-width="wide">
      <div className="gallery-intro"><p className="gallery-kicker">WORKSPACE / DESIGN STUDIO</p><h1>{theme.label}</h1><p className="gallery-description">{'description' in theme ? theme.description : 'A shared space for conversations, ideas, and work.'}</p></div>
      <div className="gallery-grid">
        <section className="gallery-main">
          <div className="work-bar"><strong>Conversations</strong><button className="work-add">New room</button><span className="gallery-meta">03 active</span></div>
          <article className="item gallery-card"><p className="gallery-meta">MAYA · PRODUCT TEAM · 10:42</p><h2>Good ideas start with a conversation.</h2><p className="gallery-copy">The first prototype is ready. Let’s walk through the details together and decide what comes next.</p><div className="gallery-wave">{Array.from({length:34},(_,i)=><i key={i} style={{height: `${12 + ((i * 17) % 43)}px`}} />)}</div><div className="gallery-actions"><button className="cal-btn">Play recording</button><button className="cal-btn" aria-pressed="true">Following</button><span className="gallery-meta">02:34</span></div></article>
          <div className="gallery-docs"><h3>Project documents</h3><table className="docs-table"><thead><tr><th>Name</th><th>Updated</th></tr></thead><tbody><tr><td>Launch notes</td><td>Today</td></tr><tr><td>Design principles</td><td>Yesterday</td></tr></tbody></table></div>
        </section>
        <aside className="layout-panel gallery-panel"><header className="layout-panel-header">Plan the next step</header><div className="layout-panel-body"><form className="ui-form" onSubmit={event=>event.preventDefault()}><label className="ui-field"><span className="ui-label">Room name</span><input className="ui-input" defaultValue="Design critique" /></label><label className="ui-field"><span className="ui-label">A note for the team</span><textarea className="ui-input" placeholder="What would you like to discuss?" /></label><p className="ui-form-help">Everyone in the workspace can join.</p><button className="ui-button">Create conversation</button><button className="ui-button" data-button="quiet">Cancel</button><button className="ui-button" disabled>Scheduled for later</button></form></div><footer className="layout-panel-footer"><span className="gallery-meta">ALL CHANGES SAVED</span></footer></aside>
      </div>
    </main>
  </>
}
createRoot(document.getElementById('root')!).render(<Gallery />)
