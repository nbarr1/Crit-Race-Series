"use client";

import { useEffect, useRef, useState } from "react";
import { parseQrPayload } from "@/lib/offline/check-in-queue";
import { Button } from "@/components/ui/button";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/**
 * Camera QR scanner. Uses the browser's BarcodeDetector where it exists
 * (Chrome on Android) and falls back to jsQR (iOS Safari). Works offline.
 */
export function Scanner({ onResult, onClose }: { onResult: (registrationId: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("Point the camera at the rider's check-in code.");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setError("The camera isn't available. Allow camera access in the browser settings, or search by name or bib.");
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;

      const tick = async () => {
        if (stopped || !video.videoWidth) {
          frame = requestAnimationFrame(tick);
          return;
        }
        let text: string | null = null;
        try {
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue ?? null;
          } else if (jsQR && ctx) {
            const w = Math.min(640, video.videoWidth);
            const h = Math.round((video.videoHeight / video.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
          }
        } catch {
          // Keep scanning.
        }
        if (text) {
          const id = parseQrPayload(text);
          if (id) {
            if ("vibrate" in navigator) navigator.vibrate(80);
            onResult(id);
            return;
          }
          setHint("That code isn't a check-in code. Try the rider's code from My races.");
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="font-semibold text-destructive">
          {error}
        </p>
      ) : (
        <>
          <video ref={videoRef} className="aspect-square w-full rounded-lg bg-black object-cover" playsInline muted aria-label="Camera view" />
          <p role="status">{hint}</p>
        </>
      )}
      <Button type="button" variant="secondary" className="w-full" onClick={onClose}>
        Close the scanner
      </Button>
    </div>
  );
}
