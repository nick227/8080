import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeSwitcher } from '../src/components/ThemeSwitcher'
import { initializeTheme } from '../src/theme/store'

initializeTheme()
createRoot(document.getElementById('root')!).render(
  <header className="masthead">
    <button className="mast-icon">Home</button>
    <p className="mast">8080</p>
    <div className="mast-actions"><ThemeSwitcher /><button className="mast-icon">User</button></div>
  </header>,
)
