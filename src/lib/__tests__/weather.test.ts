import { describe, expect, it } from "vitest";
import sample from "./fixtures/open-meteo-sample.json";
import {
  arrowRotation,
  compassName,
  compassPoint,
  daysUntil,
  forecastUrl,
  formatLocalClock,
  inForecastRange,
  localHourKey,
  parseNwsAlerts,
  summarizeForecast,
  type OpenMeteoResponse,
} from "@/lib/weather";

describe("forecastUrl", () => {
  it("asks for the variables the panel shows, in US units and Eastern Time", () => {
    const u = new URL(forecastUrl("https://api.open-meteo.com", 35.23381, -82.73429, "2027-05-12"));
    expect(u.pathname).toBe("/v1/forecast");
    expect(u.searchParams.get("latitude")).toBe("35.2338");
    expect(u.searchParams.get("hourly")).toBe(
      "temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    );
    expect(u.searchParams.get("daily")).toBe("sunrise,sunset");
    expect(u.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(u.searchParams.get("wind_speed_unit")).toBe("mph");
    expect(u.searchParams.get("timezone")).toBe("America/New_York");
    expect(u.searchParams.get("start_date")).toBe("2027-05-12");
  });
});

describe("forecast range", () => {
  it("covers today through 15 days out", () => {
    expect(daysUntil("2027-05-12", "2027-05-01")).toBe(11);
    expect(inForecastRange("2027-05-12", "2027-05-12")).toBe(true);
    expect(inForecastRange("2027-05-27", "2027-05-12")).toBe(true);
    expect(inForecastRange("2027-05-28", "2027-05-12")).toBe(false);
    expect(inForecastRange("2027-05-11", "2027-05-12")).toBe(false);
  });
});

describe("summarizeForecast", () => {
  // 5:15 PM to 8:20 PM EDT on May 12 (21:15 to 00:20 UTC).
  const start = new Date("2027-05-12T21:15:00Z");
  const end = new Date("2027-05-13T00:20:00Z");

  it("keeps the hours that overlap the race window", () => {
    expect(localHourKey(start)).toBe("2027-05-12T17:00");
    expect(localHourKey(end)).toBe("2027-05-12T20:00");
    const w = summarizeForecast(sample as OpenMeteoResponse, start, end);
    expect(w.hours.map((h) => h.localTime)).toEqual(["2027-05-12T17:00", "2027-05-12T18:00", "2027-05-12T19:00", "2027-05-12T20:00"]);
    expect(w.hours[0]).toEqual({
      localTime: "2027-05-12T17:00",
      temperatureF: 68.5,
      feelsLikeF: 67.5,
      precipitationChance: 10,
      windMph: 7,
      gustMph: 15,
      windFromDegrees: 315,
    });
  });

  it("summarizes gusts, rain chance, temperature, sunrise, and sunset", () => {
    const w = summarizeForecast(sample as OpenMeteoResponse, start, end);
    expect(w.maxPrecipitationChance).toBe(40);
    expect(w.maxGustMph).toBe(18);
    expect(w.temperatureRangeF).toEqual([68.5, 70]);
    expect(w.sunrise).toBe("2027-05-12T06:24");
    expect(w.sunset).toBe("2027-05-12T20:31");
  });

  it("handles a response that doesn't cover the window", () => {
    const w = summarizeForecast({ hourly: { time: [] }, daily: { time: [] } }, start, end);
    expect(w.hours).toEqual([]);
    expect(w.sunset).toBeNull();
    expect(w.temperatureRangeF).toBeNull();
  });

  it("treats missing values as unknown, not zero", () => {
    const w = summarizeForecast({ hourly: { time: ["2027-05-12T17:00"], wind_gusts_10m: [null] } }, start, end);
    expect(w.hours[0].gustMph).toBeNull();
    expect(w.maxGustMph).toBeNull();
  });
});

describe("wind direction", () => {
  it("names the 16 compass points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(22.5)).toBe("NNE");
    expect(compassPoint(315)).toBe("NW");
    expect(compassPoint(-45)).toBe("NW");
    expect(compassName(202.5)).toBe("south-southwest");
  });

  it("points the arrow where the wind is going", () => {
    expect(arrowRotation(315)).toBe(135); // from the northwest, blowing toward the southeast
    expect(arrowRotation(0)).toBe(180);
    expect(arrowRotation(270)).toBe(90);
  });
});

describe("formatting and alerts", () => {
  it("formats local clock times", () => {
    expect(formatLocalClock("2027-05-12T18:00")).toBe("6 PM");
    expect(formatLocalClock("2027-05-12T06:24")).toBe("6:24 AM");
    expect(formatLocalClock("2027-05-12T00:00")).toBe("12 AM");
    expect(formatLocalClock("2027-05-12T12:05")).toBe("12:05 PM");
  });

  it("reads NWS alert GeoJSON", () => {
    const alerts = parseNwsAlerts({
      features: [
        { properties: { event: "Severe Thunderstorm Warning", headline: "Severe Thunderstorm Warning until 7:00 PM", severity: "Severe", ends: "2027-05-12T19:00:00-04:00" } },
        { properties: { headline: "no event" } },
      ],
    });
    expect(alerts).toEqual([
      { event: "Severe Thunderstorm Warning", headline: "Severe Thunderstorm Warning until 7:00 PM", severity: "Severe", ends: "2027-05-12T19:00:00-04:00" },
    ]);
    expect(parseNwsAlerts(null)).toEqual([]);
  });
});
