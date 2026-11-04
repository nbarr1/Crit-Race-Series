import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { forecastUrl, parseNwsAlerts, summarizeForecast, type NwsAlert, type OpenMeteoResponse, type RaceWeather } from "@/lib/weather";

const OPEN_METEO = process.env.OPEN_METEO_BASE_URL || "https://api.open-meteo.com";
const NWS = process.env.NWS_BASE_URL || "https://api.weather.gov";

export type CachedForecast = { weather: RaceWeather; fetchedAt: string };

/**
 * Forecast for the race window, cached on the server for 30 minutes
 * (section 5.5). Throws on failure so a failed request is never cached;
 * the caller shows "weather unavailable" instead.
 */
export async function getRaceForecast(lat: number, lon: number, date: string, startIso: string, endIso: string): Promise<CachedForecast> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1800, expire: 3600 });
  cacheTag("weather", `weather:${date}`);
  const res = await fetch(forecastUrl(OPEN_METEO, lat, lon, date), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse;
  return { weather: summarizeForecast(data, new Date(startIso), new Date(endIso)), fetchedAt: new Date().toISOString() };
}

/**
 * Active National Weather Service alerts for the venue (optional). NWS asks
 * API clients to identify themselves, so this runs only when NWS_USER_AGENT
 * is set.
 */
export async function getWeatherAlerts(lat: number, lon: number): Promise<NwsAlert[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  cacheTag("weather");
  const ua = process.env.NWS_USER_AGENT;
  if (!ua) return [];
  const res = await fetch(`${NWS}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { "user-agent": ua, accept: "application/geo+json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`nws ${res.status}`);
  return parseNwsAlerts(await res.json());
}
