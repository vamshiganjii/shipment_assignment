import { useEffect, useState } from "react"

import { api } from "@/lib/api"


export type ServerStatus = "checking" | "waking" | "ready" | "down"

const SLOW_MS = 1500
const RETRY_MS = 3000
const REQUEST_TIMEOUT_MS = 45_000
const GIVE_UP_MS = 120_000

/** Waits until the API answers /health. `retry` starts checking again after "down". */
export function useServerReady(): { status: ServerStatus; retry: () => void } {
  const [status, setStatus] = useState<ServerStatus>("checking")
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setStatus("checking")
    setAttempt((a) => a + 1)
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const start = Date.now()
    const slow = setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === "checking" ? "waking" : s))
    }, SLOW_MS)

    const poll = async () => {
      while (!cancelled) {
        try {
          await api.health(AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]))
          if (!cancelled) setStatus("ready")
          return
        } catch {
          if (cancelled) return
          if (Date.now() - start > GIVE_UP_MS) {
            setStatus("down")
            return
          }
          setStatus("waking")
          await new Promise((r) => setTimeout(r, RETRY_MS))
        }
      }
    }
    void poll()

    return () => {
      cancelled = true
      clearTimeout(slow)
      controller.abort()
    }
  }, [attempt])

  return { status, retry }
}
