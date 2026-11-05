import { connection } from "next/server";
import { getRaceForecast, getWeatherAlerts, type CachedForecast } from "@/lib/weather-service";
import { arrowRotation, compassName, compassPoint, formatLocalClock, inForecastRange } from "@/lib/weather";
import type { NwsAlert } from "@/lib/weather";
import { formatDateTime, todayInDisplayTz } from "@/lib/time";
import { Alert } from "@/components/ui/card";

const r = (n: number | null, unit = "") => (n === null ? "—" : `${Math.round(n)}${unit}`);

function WindArrow({ fromDegrees }: { fromDegrees: number }) {
  return (
    <svg viewBox="0 0 24 24" className="inline-block size-6 align-middle" aria-hidden="true" style={{ transform: `rotate(${arrowRotation(fromDegrees)}deg)` }}>
      <path d="M12 2 L18 14 H13 V22 H11 V14 H6 Z" fill="currentColor" />
    </svg>
  );
}

function windLabel(deg: number | null) {
  return deg === null ? "direction unknown" : `from the ${compassName(deg)} (${compassPoint(deg)})`;
}

/**
 * Weather for the race window at the venue (section 5.5). The forecast is
 * cached for 30 minutes; staff can add a text override such as course
 * conditions.
 */
export async function WeatherPanel({
  lat,
  lon,
  eventDate,
  windowStart,
  windowEnd,
  overrideText,
  canceled,
}: {
  lat: number;
  lon: number;
  eventDate: string;
  windowStart: string;
  windowEnd: string;
  overrideText: string | null;
  canceled: boolean;
}) {
  await connection();
  const today = todayInDisplayTz();
  const inRange = inForecastRange(eventDate, today);
  const past = eventDate < today;

  let forecast: CachedForecast | null = null;
  let failed = false;
  let alerts: NwsAlert[] = [];
  if (inRange && !canceled) {
    const [f, a] = await Promise.allSettled([
      getRaceForecast(lat, lon, eventDate, windowStart, windowEnd),
      eventDate === today || eventDate <= addDays(today, 2) ? getWeatherAlerts(lat, lon) : Promise.resolve([]),
    ]);
    if (f.status === "fulfilled") forecast = f.value;
    else {
      failed = true;
      console.error("weather fetch failed", f.reason instanceof Error ? f.reason.message : f.reason);
    }
    if (a.status === "fulfilled") alerts = a.value;
  }
  const w = forecast?.weather;
  const windHours = w?.hours.filter((h) => h.windMph !== null) ?? [];
  const avgWind = windHours.length ? windHours.reduce((s, h) => s + (h.windMph ?? 0), 0) / windHours.length : null;
  const mainDir = w?.hours.find((h) => h.windFromDegrees !== null)?.windFromDegrees ?? null;

  return (
    <section aria-labelledby="weather-heading" className="space-y-3">
      <h2 id="weather-heading" className="text-2xl font-bold">
        Race-day weather
      </h2>

      {overrideText ? (
        <Alert tone="info">
          <p className="font-semibold">Note from race staff</p>
          <p className="whitespace-pre-line">{overrideText}</p>
        </Alert>
      ) : null}

      {alerts.map((a) => (
        <Alert key={a.headline} tone="error">
          <p className="font-semibold">{a.event}</p>
          <p>{a.headline}</p>
        </Alert>
      ))}

      {canceled ? (
        <p>This event is canceled.</p>
      ) : past ? (
        <p>Race day has passed.</p>
      ) : !inRange ? (
        <p>Forecast available closer to race day.</p>
      ) : failed || !w ? (
        <p>The forecast isn&apos;t available right now. Check back soon.</p>
      ) : w.hours.length === 0 ? (
        <p>Forecast available closer to race day.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border-2 border-border p-3">
              <dt className="text-sm text-muted-foreground">Temperature</dt>
              <dd className="text-xl font-bold">
                {w.temperatureRangeF
                  ? Math.round(w.temperatureRangeF[0]) === Math.round(w.temperatureRangeF[1])
                    ? r(w.temperatureRangeF[0], "°F")
                    : `${r(w.temperatureRangeF[0])}-${r(w.temperatureRangeF[1])}°F`
                  : "—"}
              </dd>
            </div>
            <div className="rounded-lg border-2 border-border p-3">
              <dt className="text-sm text-muted-foreground">Feels like</dt>
              <dd className="text-xl font-bold">{r(w.hours[0].feelsLikeF, "°F")}</dd>
            </div>
            <div className="rounded-lg border-2 border-border p-3">
              <dt className="text-sm text-muted-foreground">Chance of rain</dt>
              <dd className="text-xl font-bold">Up to {r(w.maxPrecipitationChance, "%")}</dd>
            </div>
            <div className="rounded-lg border-2 border-border p-3">
              <dt className="text-sm text-muted-foreground">Wind</dt>
              <dd className="text-xl font-bold">
                {mainDir !== null ? <WindArrow fromDegrees={mainDir} /> : null} {r(avgWind, " mph")}
                <span className="block text-base font-normal">
                  Gusts to {r(w.maxGustMph, " mph")}, {windLabel(mainDir)}
                </span>
              </dd>
            </div>
            <div className="rounded-lg border-2 border-border p-3">
              <dt className="text-sm text-muted-foreground">Sunrise</dt>
              <dd className="text-xl font-bold">{w.sunrise ? formatLocalClock(w.sunrise) : "—"}</dd>
            </div>
            <div className="rounded-lg border-2 border-border p-3">
              <dt className="text-sm text-muted-foreground">Sunset</dt>
              <dd className="text-xl font-bold">{w.sunset ? formatLocalClock(w.sunset) : "—"}</dd>
            </div>
          </dl>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm sm:text-base">
              <caption className="sr-only">Hourly forecast during racing</caption>
              <thead>
                <tr className="border-b-2 border-foreground">
                  <th scope="col" className="py-1 pr-2">Time</th>
                  <th scope="col" className="px-2 py-1 text-right">Temp</th>
                  <th scope="col" className="px-2 py-1 text-right">Feels</th>
                  <th scope="col" className="px-2 py-1 text-right">Rain</th>
                  <th scope="col" className="px-2 py-1 text-right">Wind</th>
                  <th scope="col" className="py-1 pl-2">Direction</th>
                </tr>
              </thead>
              <tbody>
                {w.hours.map((h) => (
                  <tr key={h.localTime} className="border-b border-border">
                    <th scope="row" className="py-1 pr-2 font-semibold">{formatLocalClock(h.localTime)}</th>
                    <td className="px-2 py-1 text-right">{r(h.temperatureF, "°")}</td>
                    <td className="px-2 py-1 text-right">{r(h.feelsLikeF, "°")}</td>
                    <td className="px-2 py-1 text-right">{r(h.precipitationChance, "%")}</td>
                    <td className="px-2 py-1 text-right">
                      {r(h.windMph)}
                      {h.gustMph !== null ? <span className="text-muted-foreground"> (g{r(h.gustMph)})</span> : null}
                    </td>
                    <td className="py-1 pl-2">
                      {h.windFromDegrees !== null ? (
                        <>
                          <WindArrow fromDegrees={h.windFromDegrees} /> {compassPoint(h.windFromDegrees)}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            Wind in mph; g means gusts. The arrow points the way the wind blows. Last updated {formatDateTime(forecast!.fetchedAt)}.{" "}
            <a href="https://open-meteo.com/" className="underline" rel="noopener noreferrer">
              Weather data by Open-Meteo.com
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
