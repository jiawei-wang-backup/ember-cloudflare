import { pulseStatusLabels, type PulseStatus } from "@ember/protocol";
import { cn } from "@/lib/utils";

export function PulseStatusBadge({value, label}: {value: string; label?: string}) {
  const tone = value === "blocked" ? "bg-negative/10 text-negative" : ["merged", "completed", "accepted", "recorded"].includes(value) ? "bg-positive/10 text-foreground" : ["open", "pending", "awaiting_acceptance", "paused", "draft"].includes(value) ? "bg-warning/15 text-foreground" : "bg-hover text-message-muted";
  const dot = value === "blocked" ? "bg-negative" : ["on_track", "merged", "completed", "accepted", "recorded"].includes(value) ? "bg-positive" : ["open", "pending", "awaiting_acceptance", "paused", "draft"].includes(value) ? "bg-warning" : "bg-muted-foreground";
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] leading-none font-medium", tone)}><span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)}/>{label || pulseStatusLabels[value as PulseStatus] || pulseStatusLabels.unknown}</span>;
}
