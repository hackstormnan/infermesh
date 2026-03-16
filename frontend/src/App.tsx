import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Overview } from './pages/Overview'
import { Requests } from './pages/Requests'
import { Workers } from './pages/Workers'
import { Models } from './pages/Models'
import { Routing } from './pages/Routing'
import { Metrics } from './pages/Metrics'
import { Simulation } from './pages/Simulation'

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview"   element={<Overview />}   />
          <Route path="/requests"   element={<Requests />}   />
          <Route path="/workers"    element={<Workers />}    />
          <Route path="/models"     element={<Models />}     />
          <Route path="/routing"    element={<Routing />}    />
          <Route path="/metrics"    element={<Metrics />}    />
          <Route path="/simulation" element={<Simulation />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
