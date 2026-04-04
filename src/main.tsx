import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <App initialPathname={window.location.pathname} initialSearch={window.location.search} />
  </StrictMode>
)

if (root.dataset.prerenderedApp === 'true' && root.hasChildNodes()) {
  hydrateRoot(root, app)
} else {
  root.innerHTML = ''
  createRoot(root).render(app)
}
