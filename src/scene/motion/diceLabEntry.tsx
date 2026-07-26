import { createRoot } from 'react-dom/client'
import { DiceLab } from './DiceLab'

// Entry for /dice-lab.html — a visual-QA-only stage for one dice throw.
createRoot(document.getElementById('root')!).render(<DiceLab />)
