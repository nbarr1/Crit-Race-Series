import QRCode from "qrcode";
import { QR_PREFIX } from "@/lib/offline/check-in-queue";

/** The rider's check-in QR code. Rendered on the server as SVG. */
export async function CheckInCode({ registrationId, label }: { registrationId: string; label: string }) {
  const svg = await QRCode.toString(`${QR_PREFIX}${registrationId}`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return (
    <details className="rounded-lg border-2 border-border p-3">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">Show my check-in code</summary>
      <div className="mt-2 space-y-2">
        <div
          role="img"
          aria-label={`Check-in code for ${label}`}
          className="mx-auto w-56 max-w-full bg-white [&_svg]:h-auto [&_svg]:w-full"
          // The SVG comes from the qrcode library, not from user input.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="text-sm">
          Show this at the registration desk. Signal at the park can be weak, so take a screenshot before you go.
        </p>
      </div>
    </details>
  );
}
