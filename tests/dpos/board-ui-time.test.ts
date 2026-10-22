import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { day, localDay, when } from "../../src/components/board/ui";

// Stage 4D: instants are shown in the company time zone. They are never shown in the server's or browser's zone,
// and a missing zone is never silently treated as UTC.
describe("Stage 4D board time display", () => {
  const instant = "2026-10-22T02:11:00.000Z"; // 9:11 PM on Oct 21 in America/Chicago (CDT)

  it("formats an instant in the company time zone", () => {
    assert.match(when(instant, "America/Chicago"), /Oct 21, 2026, 9:11 PM/);
    assert.match(when(instant, "Asia/Tokyo"), /Oct 22, 2026, 11:11 AM/);
  });

  it("labels the fallback instead of silently using UTC when no usable zone exists", () => {
    for (const zone of [null, "Not/AZone"]) {
      const text = when(instant, zone);
      assert.match(text, /UTC \(company time zone not available\)/);
    }
  });

  it("returns n/a for missing or invalid instants", () => {
    assert.equal(when(null, "America/Chicago"), "n/a");
    assert.equal(when("garbage", "America/Chicago"), "n/a");
  });

  it("derives the company-local calendar day, and leaves date-only values unshifted", () => {
    assert.match(localDay(instant, "America/Chicago"), /2026-10-21|Oct 21, 2026/);
    assert.match(day("2026-10-21"), /2026-10-21|Oct 21, 2026/);
  });

  it("never formats a time with the browser's locale in a client component", () => {
    const client = fs.readFileSync(path.join(process.cwd(), "src/components/board/client.tsx"), "utf8");
    assert.doesNotMatch(client, /toLocale(Date|Time)?String/);
  });
});
