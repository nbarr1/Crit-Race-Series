import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border-2 border-border bg-card p-4 text-card-foreground", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "bg-muted text-foreground",
    success: "bg-success text-white",
    warning: "bg-warning text-black",
    danger: "bg-destructive text-white",
  } as const;
  return (
    <span
      className={cn("inline-flex items-center rounded px-2 py-0.5 text-sm font-semibold", tones[tone], className)}
      {...props}
    />
  );
}

export function Alert({
  className,
  tone = "info",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: "info" | "error" | "success" }) {
  const tones = {
    info: "border-primary bg-primary/10",
    error: "border-destructive bg-destructive/10",
    success: "border-success bg-success/10",
  } as const;
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border-l-4 p-3", tones[tone], className)} {...props} />;
}
