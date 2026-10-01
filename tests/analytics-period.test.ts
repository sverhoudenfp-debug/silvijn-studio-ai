import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENCY_TIMEZONE,
  bucketCounts,
  bucketSums,
  dailyBuckets,
  monthlyBuckets,
  parsePeriodSearchParams,
  periodRange,
  previousRange,
} from "../lib/analytics/period";

/**
 * Regressietests — analytics-periodelogica (2026-10-01).
 * Gedekte klasse van bugs:
 *  1. Dag-/week-/maand-/jaargrenzen in de VERKEERDE tijdzone (Vercel draait
 *     UTC; "vandaag" begint in Amsterdam om 00:00, niet om 00:00 UTC).
 *  2. Zomer-/wintertijdovergangen (laatste zondag maart/oktober).
 *  3. Weekstart op zondag i.p.v. maandag (NL-conventie).
 *  4. Periode-over-periode vergelijking met ongelijke lengtes.
 *  5. Bucket-grenzen: [from, to) — een event exact op de grens hoort bij de
 *     nieuwe bucket, nooit dubbel.
 */

test("agents-tijdzone is Europe/Amsterdam (eigenaarsconventie, geen servertijd)", () => {
  assert.equal(AGENCY_TIMEZONE, "Europe/Amsterdam");
});

test("vandaag: begint op lokale middernacht, winter (UTC+1)", () => {
  const now = new Date("2026-01-15T15:30:00Z"); // 16:30 lokale tijd
  const range = periodRange("today", now);
  assert.equal(range.from.toISOString(), "2026-01-14T23:00:00.000Z");
  assert.equal(range.to, now);
});

test("vandaag: begint op lokale middernacht, zomer (UTC+2)", () => {
  const now = new Date("2026-07-15T15:30:00Z"); // 17:30 lokale tijd
  const range = periodRange("today", now);
  assert.equal(range.from.toISOString(), "2026-07-14T22:00:00.000Z");
});

test("week: maandag als start, niet zondag", () => {
  // Donderdag 1 oktober 2026, 15:30 UTC — week start maandag 28 september.
  const now = new Date("2026-10-01T15:30:00Z");
  const range = periodRange("week", now);
  assert.equal(range.from.toISOString(), "2026-09-27T22:00:00.000Z"); // ma 00:00 Amsterdam (+2)
});

test("week: zondagavond valt nog in de lopende week", () => {
  const now = new Date("2026-10-04T20:00:00Z"); // zondag 22:00 lokale tijd
  const range = periodRange("week", now);
  assert.equal(range.from.toISOString(), "2026-09-27T22:00:00.000Z");
});

test("maand: begint op de 1e van de lokale maand", () => {
  const now = new Date("2026-10-01T08:00:00Z");
  const range = periodRange("month", now);
  assert.equal(range.from.toISOString(), "2026-09-30T22:00:00.000Z"); // 1 okt 00:00 Amsterdam
});

test("jaar: begint op 1 januari lokale tijd (wintertijd)", () => {
  const now = new Date("2026-10-01T08:00:00Z");
  const range = periodRange("year", now);
  assert.equal(range.from.toISOString(), "2025-12-31T23:00:00.000Z"); // 1 jan 00:00 Amsterdam (+1)
});

test("custom: geldige range wordt geaccepteerd, ongeldige valt terug op maand", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const custom = periodRange("custom", now, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(custom.kind, "custom");
  assert.equal(custom.from.toISOString(), "2026-08-31T22:00:00.000Z"); // 1 sep 00:00 Amsterdam
  assert.equal(custom.label, "1-9-2026 – 30-9-2026");

  const invalid = periodRange("custom", now, { from: "2026-13-40", to: "geen-datum" });
  assert.equal(invalid.kind, "month");

  const reversed = periodRange("custom", now, { from: "2026-09-30", to: "2026-09-01" });
  assert.equal(reversed.kind, "month");
});

test("parsePeriodSearchParams: default maand, onbekende waarde maand, all doorlaten", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  assert.equal(parsePeriodSearchParams({}, now).kind, "month");
  assert.equal(parsePeriodSearchParams({ period: "nonsense" }, now).kind, "month");
  assert.equal(parsePeriodSearchParams({ period: "week" }, now).kind, "week");
  assert.equal(parsePeriodSearchParams({ period: "all" }, now).kind, "all");
  assert.equal(parsePeriodSearchParams({ period: "custom", from: "2026-09-01", to: "2026-09-30" }, now).kind, "custom");
});

test("previousRange: zelfde lengte direct voor de huidige periode", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const range = periodRange("month", now);
  const prev = previousRange(range);
  assert.ok(prev);
  assert.equal(prev.to.getTime(), range.from.getTime());
  const length = range.to.getTime() - range.from.getTime();
  assert.equal(prev.to.getTime() - prev.from.getTime(), length);
  assert.equal(previousRange(periodRange("all", now)), null);
});

test("monthlyBuckets: twaalf maanden, DST-grenzen kloppen, keys oplopend", () => {
  const to = new Date("2026-10-01T12:00:00Z");
  const buckets = monthlyBuckets(new Date("2026-01-05T00:00:00Z"), to, 12);
  assert.equal(buckets.length, 10); // jan..okt 2026
  assert.equal(buckets[0].key, "2026-01");
  assert.equal(buckets[buckets.length - 1].key, "2026-10");
  // Januari-bucket start op lokale middernacht wintertijd...
  assert.equal(buckets[0].from.toISOString(), "2025-12-31T23:00:00.000Z");
  // ...oktober op zomertijd (maart-overgang zit ertussen).
  assert.equal(buckets[9].from.toISOString(), "2026-09-30T22:00:00.000Z");
});

test("monthlyBuckets: respecteert maxBuckets (nieuwste maanden tellen)", () => {
  const to = new Date("2026-12-15T00:00:00Z");
  const buckets = monthlyBuckets(new Date("2020-01-01T00:00:00Z"), to, 12);
  assert.equal(buckets.length, 12);
  assert.equal(buckets[0].key, "2026-01");
  assert.equal(buckets[11].key, "2026-12");
});

test("dailyBuckets: dagelijkse buckets over een korte periode", () => {
  const buckets = dailyBuckets(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-04T10:00:00Z"));
  assert.equal(buckets.length, 4);
  assert.equal(buckets[0].key, "2026-10-01");
  assert.equal(buckets[3].key, "2026-10-04");
});

test("bucketCounts en bucketSums: [from, to)-grenzen, geen dubbeltelling", () => {
  const buckets = dailyBuckets(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-03T10:00:00Z"));
  const events = [
    { ts: "2026-10-01T10:00:00Z", v: 10 },
    // Exact op de bucketgrens (2 okt 00:00 Amsterdam): hoort bij de NIEUWE
    // bucket — [from, to), nooit dubbelteld.
    { ts: "2026-10-01T22:00:00Z", v: 5 },
    { ts: "2026-10-02T10:00:00Z", v: 20 },
    { ts: "2026-10-05T00:00:00Z", v: 99 }, // buiten alle buckets
  ];
  assert.deepEqual(bucketCounts(events, buckets, (e) => e.ts), [1, 2, 0]);
  assert.deepEqual(bucketSums(events, buckets, (e) => e.ts, (e) => e.v), [10, 25, 0]);
});

test("bucketCounts: null/undefined-timestamps worden overgeslagen, geen crash", () => {
  const buckets = dailyBuckets(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-02T10:00:00Z"));
  const events = [{ ts: null }, { ts: undefined }, { ts: "2026-10-01T12:00:00Z" }];
  assert.deepEqual(bucketCounts(events, buckets, (e) => e.ts), [1, 0]);
});
