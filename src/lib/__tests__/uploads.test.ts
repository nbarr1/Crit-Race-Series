import { describe, expect, it } from "vitest";
import { checkUpload } from "@/lib/uploads";

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type });

describe("checkUpload", () => {
  it("accepts course maps and gives them random names", () => {
    const r = checkUpload(file("My Map.png", "image/png"), "course_map", "events/e1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toMatch(/^events\/e1\/[0-9a-f-]{36}\.png$/);
      expect(r.contentType).toBe("image/png");
    }
  });

  it("rejects the wrong type, empty files, and files over the limit", () => {
    expect(checkUpload(file("x.html", "text/html"), "course_map", "f")).toMatchObject({ ok: false });
    expect(checkUpload(file("x.png", "image/png", 0), "course_map", "f")).toMatchObject({ ok: false, error: "Choose a file." });
    expect(checkUpload(file("x.png", "image/png", 5 * 1024 * 1024), "course_map", "f")).toMatchObject({ ok: false });
    expect(checkUpload(null, "logo", "f")).toMatchObject({ ok: false });
  });

  it("needs a .gpx name for GPX files, whatever type the browser reports", () => {
    expect(checkUpload(file("loop.gpx", "application/octet-stream"), "gpx", "f")).toMatchObject({ ok: true, contentType: "application/gpx+xml" });
    expect(checkUpload(file("loop.txt", "application/octet-stream"), "gpx", "f")).toMatchObject({ ok: false });
  });
});
