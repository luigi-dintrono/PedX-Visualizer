import * as React from "react"
import { cn } from "@/lib/utils"

export interface ListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

const ListItem = React.forwardRef<HTMLDivElement, ListItemProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-between p-3 hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
ListItem.displayName = "ListItem"

export { ListItem }
