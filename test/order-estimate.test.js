const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PREP_MINUTES,
  estimateReadyAt,
  historicalPrepMinutesFromOrders,
} = require("../src/utils/order-estimate");

test("historicalPrepMinutesFromOrders returns the median prep duration", () => {
  const minutes = historicalPrepMinutesFromOrders([
    {
      inProgressStartedAt: "2026-05-16T10:00:00.000Z",
      readyAt: "2026-05-16T10:10:00.000Z",
    },
    {
      inProgressStartedAt: "2026-05-16T11:00:00.000Z",
      readyAt: "2026-05-16T11:15:00.000Z",
    },
    {
      inProgressStartedAt: "2026-05-16T12:00:00.000Z",
      readyAt: "2026-05-16T12:20:00.000Z",
    },
  ]);

  assert.equal(minutes, 15);
});

test("historicalPrepMinutesFromOrders ignores invalid outlier durations", () => {
  const minutes = historicalPrepMinutesFromOrders([
    {
      inProgressStartedAt: "2026-05-16T10:00:00.000Z",
      readyAt: "2026-05-16T10:00:20.000Z",
    },
    {
      inProgressStartedAt: "2026-05-16T11:00:00.000Z",
      readyAt: "2026-05-16T15:30:00.000Z",
    },
    {
      inProgressStartedAt: "2026-05-16T12:00:00.000Z",
      readyAt: "2026-05-16T12:14:00.000Z",
    },
  ]);

  assert.equal(minutes, 14);
});

test("historicalPrepMinutesFromOrders falls back to default with no valid history", () => {
  const minutes = historicalPrepMinutesFromOrders([]);
  assert.equal(minutes, DEFAULT_PREP_MINUTES);
});

test("estimateReadyAt adds minutes to the start time", () => {
  const estimatedReadyAt = estimateReadyAt(new Date("2026-05-16T10:00:00.000Z"), 15);
  assert.equal(estimatedReadyAt.toISOString(), "2026-05-16T10:15:00.000Z");
});
