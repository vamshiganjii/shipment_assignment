import { useLayoutEffect, useRef, useState } from "react"

export function useElementWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (w: number) => setWidth(Math.max(240, Math.floor(w)))
    update(el.getBoundingClientRect().width) // measure synchronously before first paint
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
