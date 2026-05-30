import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary/40 focus-visible:shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]",
        "aria-invalid:shadow-[0_0_0_1px_hsl(var(--destructive)/0.2)] dark:aria-invalid:shadow-[0_0_0_1px_hsl(var(--destructive)/0.4)] aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
