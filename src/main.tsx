import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.tsx'
import { DatabaseProvider } from './DatabaseContext.jsx'
import { DriveSyncProvider } from './DriveSyncContext.jsx'

const googleOAuthClientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID

if (!googleOAuthClientId) {
  throw new Error('Missing VITE_GOOGLE_OAUTH_CLIENT_ID environment variable.')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={googleOAuthClientId}>
      <DriveSyncProvider>
        <DatabaseProvider>
          <App />
        </DatabaseProvider>
      </DriveSyncProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
)
