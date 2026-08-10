// nativeFetch must be the FIRST import: it patches window.fetch for the native
// shell before any module-scope code can issue an API call.
import './nativeFetch.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App'

// Vercel Web Analytics (page views only — no Speed Insights, that's paid and
// declined). inject() no-ops safely in local dev; it only reports once deployed
// on Vercel with Web Analytics enabled for the project.
inject()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
