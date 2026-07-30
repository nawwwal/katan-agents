import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App'
import { BoardLab } from './scene/BoardLab'
import { AssetReviewApp } from './scene/procedural/AssetReviewApp'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const route = params.has('asset-review') ? <AssetReviewApp /> : params.has('board') ? <BoardLab /> : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route}
    {import.meta.env.PROD && <Analytics />}
  </StrictMode>,
)
