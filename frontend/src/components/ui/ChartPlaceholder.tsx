interface ChartPlaceholderProps {
  height?: number
}

const BAR_VALUES = [42, 68, 55, 80, 73, 91, 64, 77, 85, 59, 93, 70]

export function ChartPlaceholder({ height = 80 }: ChartPlaceholderProps) {
  const max = Math.max(...BAR_VALUES)
  const barWidth = 6
  const gap = 4
  const totalWidth = BAR_VALUES.length * (barWidth + gap) - gap

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${totalWidth} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {BAR_VALUES.map((val, i) => {
        const barHeight = (val / max) * (height - 4)
        const x = i * (barWidth + gap)
        const y = height - barHeight
        const isHigh = val >= 85

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={2}
            fill={isHigh ? 'rgba(59,130,246,0.6)' : 'rgba(59,130,246,0.25)'}
          />
        )
      })}
    </svg>
  )
}

export function LineChartPlaceholder({ height = 80 }: ChartPlaceholderProps) {
  const points = [30, 45, 38, 60, 52, 70, 64, 78, 72, 88, 82, 95]
  const max = Math.max(...points)
  const w = 300
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w
    const y = height - 4 - ((v / max) * (height - 8))
    return `${x},${y}`
  })
  const polyline = coords.join(' ')

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(34,197,94,0.3)" />
          <stop offset="100%" stopColor="rgba(34,197,94,0)" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${polyline} ${w},${height}`}
        fill="url(#line-fill)"
      />
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(34,197,94,0.7)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
