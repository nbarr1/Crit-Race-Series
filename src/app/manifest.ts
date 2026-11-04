import type { MetadataRoute } from "next";
import { SERIES_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SERIES_NAME,
    short_name: "Crit Series",
    description: "Schedule, registration, check-in, and results for the Conestee Crit Series.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b4fa8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Check-in", url: "/staff/check-in" }],
  };
}
