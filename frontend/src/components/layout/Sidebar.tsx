import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Zap,
  Cpu,
  Box,
  GitBranch,
  BarChart2,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react'

// ─── Nav config ───────────────────────────────────────────────────────────────

interface NavItem {
  path:  string
  label: string
  icon:  LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { path: '/overview',   label: 'Overview',   icon: LayoutDashboard },
  { path: '/requests',   label: 'Requests',   icon: Zap             },
  { path: '/workers',    label: 'Workers',    icon: Cpu             },
  { path: '/models',     label: 'Models',     icon: Box             },
  { path: '/routing',    label: 'Routing',    icon: GitBranch       },
  { path: '/metrics',    label: 'Metrics',    icon: BarChart2       },
  { path: '/simulation', label: 'Simulation', icon: PlayCircle      },
]

// ─── NavItem component ────────────────────────────────────────────────────────

function NavItemLink({ path, label, icon: Icon }: NavItem) {
  const { pathname } = useLocation()
  const isActive = pathname === path

  return (
    <Link
      to={path}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        color: isActive ? 'var(--color-text-primary)' : '#575C72',
        backgroundColor: isActive ? 'rgba(59,130,246,0.08)' : 'transparent',
        fontFamily: 'var(--font-body)',
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        textDecoration: 'none',
        transition: 'background-color 0.1s, color 0.1s',
      }}
    >
      <Icon
        size={14}
        color={isActive ? 'var(--color-blue)' : '#3D4155'}
        strokeWidth={isActive ? 2 : 1.5}
      />
      {label}
    </Link>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  return (
    <nav
      style={{
        width: 220,
        flexShrink: 0,
        height: '100%',
        backgroundColor: 'var(--color-bg-sidebar)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── Brand ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '18px 14px 14px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.5px',
            }}
          >
            IM
          </span>
        </div>

        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          InferMesh
        </span>
      </div>

      {/* ── Nav items ── */}
      <div
        style={{
          flex: 1,
          padding: '8px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          overflowY: 'auto',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavItemLink key={item.path} {...item} />
        ))}
      </div>

      {/* ── Footer: connection indicator ── */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: 'var(--color-green)',
            flexShrink: 0,
            boxShadow: '0 0 6px rgba(34,197,94,0.45)',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 500,
            color: 'rgba(34,197,94,0.38)',
          }}
        >
          System connected
        </span>
      </div>
    </nav>
  )
}
