import assert from "node:assert/strict";
import test from "node:test";
import { calculateVndPrice, parseVietcombankUsdRate, vietnamGreeting } from "../lib/pricing.ts";

test("greets according to Vietnam time", () => {
  assert.equal(vietnamGreeting(new Date("2026-08-22T01:00:00Z")), "Chào buổi sáng");
  assert.equal(vietnamGreeting(new Date("2026-08-22T07:00:00Z")), "Chào buổi chiều");
  assert.equal(vietnamGreeting(new Date("2026-08-22T13:00:00Z")), "Chào buổi tối");
});

test("converts the USD list price and rounds the total upward", () => {
  assert.equal(calculateVndPrice(6_690, 26_310, 0, 1_000), 176_014_000);
  assert.equal(calculateVndPrice(6_690, 27_000, 3, 1_000), 186_049_000);
});

test("reads the official USD selling rate from Vietcombank XML", () => {
  const result = parseVietcombankUsdRate(`<ExrateList><DateTime>8/22/2026 2:22:11 PM</DateTime>
    <Exrate CurrencyCode="USD" Buy="25,900.00" Transfer="25,930.00" Sell="26,310.00" /></ExrateList>`);
  assert.deepEqual(result, { rate: 26_310, sourceUpdatedAt: "8/22/2026 2:22:11 PM" });
});
