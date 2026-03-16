/**
 * hooks/useStreamSocket.ts
 *
 * Core WebSocket hook for the InferMesh stream gateway.
 * Manages connection lifecycle, sends a subscribe message on open,
 * and reconnects with exponential backoff on disconnect.
 *
 * Usage:
 *   const connState = useStreamSocket(['requests', 'workers'], onEvent)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type {
  StreamChannel,
  InferMeshStreamEvent,
  SubscribeMessage,
} from '../api/types/stream'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]

function wsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/v1/stream`
}

export function useStreamSocket(
  channels: StreamChannel[],
  onEvent: (event: InferMeshStreamEvent) => void,
): ConnectionState {
  const [connState, setConnState] = useState<ConnectionState>('disconnected')

  // Stable refs so the WebSocket callbacks don't capture stale closures
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  const attemptRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEventRef = useRef(onEvent)
  const channelsRef = useRef(channels)

  useEffect(() => { onEventRef.current = onEvent })
  useEffect(() => { channelsRef.current = channels })

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    // Clean up any existing socket before creating a new one
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      wsRef.current.close()
      wsRef.current = null
    }

    if (mountedRef.current) setConnState('connecting')

    const ws = new WebSocket(wsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      attemptRef.current = 0
      setConnState('connected')
      const msg: SubscribeMessage = { action: 'subscribe', channels: channelsRef.current }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (e) => {
      if (!mountedRef.current) return
      try {
        const event = JSON.parse(e.data as string) as InferMeshStreamEvent
        onEventRef.current(event)
      } catch {
        // ignore unparseable frames
      }
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      setConnState('error')
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!mountedRef.current) return
      setConnState('disconnected')
      const delay = RECONNECT_DELAYS_MS[
        Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1)
      ]
      attemptRef.current++
      timerRef.current = setTimeout(connect, delay)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ all deps are stable refs or module-level fns — empty array is intentional

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.onmessage = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return connState
}
