import React from 'react'
import { createRoot } from 'react-dom/client'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import App from './App.js'
import './styles.css'

ModuleRegistry.registerModules([AllCommunityModule])

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
