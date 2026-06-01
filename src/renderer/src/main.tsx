import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { RenderGuard } from './components/RenderGuard'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RenderGuard
      onError={(error) => {
        console.error('Fatal renderer error:', error)
      }}
      fallback={(
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f1115',
            color: '#e6e6e6',
            fontFamily: 'Inter, system-ui, sans-serif',
            padding: 24
          }}
        >
          <div style={{ maxWidth: 560, textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 22 }}>KobeanSQL hit a renderer error</h2>
            <p style={{ margin: 0, opacity: 0.85 }}>
              Please restart the app. If this keeps happening, open logs after relaunch and share them.
            </p>
          </div>
        </div>
      )}
    >
      <App />
    </RenderGuard>
  </React.StrictMode>
)
