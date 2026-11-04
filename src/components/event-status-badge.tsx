import { Badge } from "@/components/ui/card";

const LABELS = {
  upcoming: { text: "Upcoming", tone: "neutral" },
  today: { text: "Race day", tone: "success" },
  canceled: { text: "Canceled", tone: "danger" },
  completed: { text: "Completed", tone: "neutral" },
} as const;

export function EventStatusBadge({ phase }: { phase: keyof typeof LABELS }) {
  const { text, tone } = LABELS[phase];
  return <Badge tone={tone}>{text}</Badge>;
}
