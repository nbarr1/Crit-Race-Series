/**
 * Race-day weather from Open-Meteo (section 5.5). Pure functions here; the
 * cached fetch lives in weather-service.ts.
 *
 * Requests use timezone=America/New_York, so Open-Meteo returns local times
 * without an offset ("2027-05-12T18:00"). Event times are stored in UTC and
 * converted to the same local hour keys for matching.
 */
import { DISPLAY_TZ } from "@/lib/time";

export const FORECAST_DAYS = 16; // Open-Meteo's forecast horizon, today included
export const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
] as const;

export type OpenMeteoResponse = {
  hourly?: { time: string[] } & Partial<Record<(typeof HOURLY_VARS)[number], (number | null)[]>>;
  daily?: { time: string[]; sunrise?: string[]; sunset?: string[] };
};

export type WeatherHour = {
  localTime: string; // "2027-05-12T18:00"
  temperatureF: number | null;
  feelsLikeF: number | null;
  precipitationChance: number | null;
  windMph: number | null;
  gustMph: number | null;
  windFromDegrees: number | null;
};

export type RaceWeather = {
  hours: WeatherHour[];
  sunrise: string | null; // local "2027-05-12T06:22"
  sunset: string | null;
  maxGustMph: number | null;
  maxPrecipitationChance: number | null;
  temperatureRangeF: [number, number] | null;
};

export function forecastUrl(base: string, lat: number, lon: number, date: string): string {
  const u = new URL("/v1/forecast", base);
  u.searchParams.set("latitude", lat.toFixed(4));
  u.searchParams.set("longitude", lon.toFixed(4));
  u.searchParams.set("hourly", HOURLY_VARS.join(","));
  u.searchParams.set("daily", "sunrise,sunset");
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("wind_speed_unit", "mph");
  u.searchParams.set("timezone", DISPLAY_TZ);
  u.searchParams.set("start_date", date);
  u.searchParams.set("end_date", date);
  return u.toString();
}

/** Whole days from `today` to `eventDate` (both YYYY-MM-DD). */
export function daysUntil(eventDate: string, today: string): number {
  const ms = Date.UTC(+eventDate.slice(0, 4), +eventDate.slice(5, 7) - 1, +eventDate.slice(8, 10)) -
    Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

/** Open-Meteo forecasts today plus 15 days. Past race days get no forecast. */
export function inForecastRange(eventDate: string, today: string): boolean {
  const d = daysUntil(eventDate, today);
  return d >= 0 && d < FORECAST_DAYS;
}

/** A UTC instant as the local hour key Open-Meteo uses, rounded down. */
export function localHourKey(instant: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: DISPLAY_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The hours that overlap the race window (first start to last finish), with
 * a summary. Returns hours: [] when the response doesn't cover the window.
 */
export function summarizeForecast(data: OpenMeteoResponse, windowStart: Date, windowEnd: Date): RaceWeather {
  const h = data.hourly;
  const first = localHourKey(windowStart);
  const last = localHourKey(windowEnd);
  const hours: WeatherHour[] = [];
  if (h?.time) {
    h.time.forEach((t, i) => {
      if (t < first || t > last) return;
      hours.push({
        localTime: t,
        temperatureF: num(h.temperature_2m?.[i]),
        feelsLikeF: num(h.apparent_temperature?.[i]),
        precipitationChance: num(h.precipitation_probability?.[i]),
        windMph: num(h.wind_speed_10m?.[i]),
        gustMph: num(h.wind_gusts_10m?.[i]),
        windFromDegrees: num(h.wind_direction_10m?.[i]),
      });
    });
  }
  const max = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.max(...v) : null;
  };
  const temps = hours.map((x) => x.temperatureF).filter((x): x is number => x !== null);
  const dayIndex = data.daily?.time.indexOf(first.slice(0, 10)) ?? -1;
  return {
    hours,
    sunrise: dayIndex >= 0 ? (data.daily?.sunrise?.[dayIndex] ?? null) : null,
    sunset: dayIndex >= 0 ? (data.daily?.sunset?.[dayIndex] ?? null) : null,
    maxGustMph: max(hours.map((x) => x.gustMph)),
    maxPrecipitationChance: max(hours.map((x) => x.precipitationChance)),
    temperatureRangeF: temps.length ? [Math.min(...temps), Math.max(...temps)] : null,
  };
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const NAMES: Record<string, string> = {
  N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast",
  SE: "southeast", SSE: "south-southeast", S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest",
  W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest",
};

/** 16-point compass label for a wind direction (the direction it blows from). */
export function compassPoint(degrees: number): string {
  const d = ((degrees % 360) + 360) % 360;
  return POINTS[Math.round(d / 22.5) % 16];
}

export function compassName(degrees: number): string {
  return NAMES[compassPoint(degrees)];
}

/**
 * Rotation for an arrow that points the way the wind is blowing (toward),
 * drawn pointing up at 0 degrees. Meteorological direction is where wind
 * comes from, so add 180.
 */
export function arrowRotation(fromDegrees: number): number {
  return (((fromDegrees + 180) % 360) + 360) % 360;
}

/** "2027-05-12T18:00" (local) as "6 PM"; "2027-05-12T06:22" as "6:22 AM". */
export function formatLocalClock(local: string): string {
  const [hh, mm] = local.slice(11, 16).split(":").map(Number);
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

export type NwsAlert = { event: string; headline: string; severity: string; ends: string | null };

/** Active NWS alerts from the /alerts/active?point= GeoJSON response. */
export function parseNwsAlerts(json: unknown): NwsAlert[] {
  const features = (json as { features?: { properties?: Record<string, unknown> }[] })?.features ?? [];
  return features
    .map((f) => f.properties ?? {})
    .filter((p) => typeof p.event === "string")
    .map((p) => ({
      event: String(p.event),
      headline: typeof p.headline === "string" ? p.headline : String(p.event),
      severity: typeof p.severity === "string" ? p.severity : "Unknown",
      ends: typeof p.ends === "string" ? p.ends : typeof p.expires === "string" ? p.expires : null,
    }));
}
