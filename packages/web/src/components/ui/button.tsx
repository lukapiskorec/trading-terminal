import { cn } from "@/lib/cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline";
  size?: "sm" | "md";
}

export function Button({ className, variant = "default", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
        variant === "ghost" && "hover:bg-neutral-800 text-neutral-300",
        variant === "outline" && "border border-neutral-700 hover:bg-neutral-800 text-neutral-300",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-4 text-sm",
        className,
      )}
      {...props}
    />
  );
}
