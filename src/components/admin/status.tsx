import { Badge } from "@/components/ui/card";

const TONES = { draft: "warning", published: "success", canceled: "danger", completed: "neutral" } as const;
const LABELS = { draft: "Draft", published: "Published", canceled: "Canceled", completed: "Completed" } as const;

export function EventStatusBadge({ status }: { status: keyof typeof TONES }) {
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
