import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { EMRProvider } from './state/EMRContext'
import { GuidelineProvider } from './state/GuidelineContext'
import EMRLayout from './components/EMRLayout'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EMRProvider>
      <GuidelineProvider>
        <EMRLayout />
      </GuidelineProvider>
    </EMRProvider>
  </StrictMode>,
)
