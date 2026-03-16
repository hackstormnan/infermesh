import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--color-bg-base)',
      }}
    >
      <Sidebar />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <Topbar />

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            backgroundColor: 'var(--color-bg-base)',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
