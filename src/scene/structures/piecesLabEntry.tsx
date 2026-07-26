import { createRoot } from 'react-dom/client'
import { AffordanceLab, HarborLab, JoinLab, NetworkLab, PiecesLab } from './PiecesLab'

// Entry for /pieces-lab.html — a visual-QA-only stage for the game pieces.
// `?harbor` swaps to the harbour rig over water, `?net` to the road-network
// legibility harness on the real island, `?joins` to the road junction rig,
// `?aff=setup|road|city` to the legal-target rig on the real scene.
const params = new URLSearchParams(window.location.search)
const lab = params.has('aff')
  ? <AffordanceLab />
  : params.has('harbor')
    ? <HarborLab />
    : params.has('joins')
      ? <JoinLab />
      : params.has('net') ? <NetworkLab /> : <PiecesLab />
createRoot(document.getElementById('root')!).render(lab)
