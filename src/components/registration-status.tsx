import { Badge } from "@/components/ui/card";
import type { RegistrationStatus } from "@/lib/types";

const LABEL: Record<RegistrationStatus, { text: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending_payment: { text: "Payment needed", tone: "warning" },
  confirmed: { text: "Confirmed", tone: "success" },
  waitlisted: { text: "Waitlisted", tone: "warning" },
  canceled: { text: "Canceled", tone: "neutral" },
  refunded: { text: "Refunded", tone: "neutral" },
};

export function RegistrationStatusBadge({ status, waitlistPosition }: { status: RegistrationStatus; waitlistPosition?: number | null }) {
  const { text, tone } = LABEL[status];
  return (
    <Badge tone={tone}>
      {text}
      {status === "waitlisted" && waitlistPosition ? ` (#${waitlistPosition})` : ""}
    </Badge>
  );
}
