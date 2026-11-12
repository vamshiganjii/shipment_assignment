import { useEffect, useState } from "react"

export interface AsyncState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
}


export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  enabled = true,
  delayMs = 0,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: enabled })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: undefined }))
    const timer = setTimeout(() => {
      fn(controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setState({ data, error: undefined, loading: false })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setState((s) => ({ ...s, error: error instanceof Error ? error : new Error(String(error)), loading: false }))
        })
    }, delayMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [...deps, enabled])

  return state
}
