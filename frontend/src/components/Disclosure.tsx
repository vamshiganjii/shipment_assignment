import { ChevronDown } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Disclosure({
  id,
  title,
  hint,
  boxed = true,
  children,
}: {
  id?: string
  title: string
  hint?: string
  boxed?: boolean
  children: ReactNode
}) {
  return (
    <details
      id={id}
      open={id ? window.location.hash === `#${id}` : undefined}
      className={cn("group scroll-mt-20", boxed && "rounded-xl border bg-card")}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden",
          !boxed && "rounded-xl border bg-card",
        )}
      >
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <div>
          <div className="text-sm font-medium">{title}</div>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
      </summary>
      <div className={cn("space-y-6", boxed ? "border-t px-5 py-5" : "pt-4")}>{children}</div>
    </details>
  )
}
