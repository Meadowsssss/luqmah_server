const DEFAULT_PREP_MINUTES = 15;
const MIN_VALID_DURATION_MINUTES = 1;
const MAX_VALID_DURATION_MINUTES = 180;
const MAX_SAMPLE_SIZE = 20;

const isValidDurationMinutes = (minutes) =>
  minutes >= MIN_VALID_DURATION_MINUTES && minutes <= MAX_VALID_DURATION_MINUTES;

const median = (values) => {
  if (!values.length) {
    return DEFAULT_PREP_MINUTES;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middleIndex];
  }
  return Math.round((sorted[middleIndex - 1] + sorted[middleIndex]) / 2);
};

const durationMinutesForOrder = (order) => {
  if (!order?.inProgressStartedAt || !order?.readyAt) {
    return null;
  }

  const startedAt = new Date(order.inProgressStartedAt);
  const readyAt = new Date(order.readyAt);
  const diffMinutes = Math.round((readyAt.getTime() - startedAt.getTime()) / 60000);
  return isValidDurationMinutes(diffMinutes) ? diffMinutes : null;
};

const estimateReadyAt = (startedAt, prepMinutes) => {
  return new Date(startedAt.getTime() + prepMinutes * 60000);
};

const historicalPrepMinutesFromOrders = (orders) => {
  const durations = orders
    .map(durationMinutesForOrder)
    .filter((minutes) => minutes != null)
    .slice(0, MAX_SAMPLE_SIZE);

  if (!durations.length) {
    return DEFAULT_PREP_MINUTES;
  }

  return median(durations);
};

module.exports = {
  DEFAULT_PREP_MINUTES,
  MAX_SAMPLE_SIZE,
  estimateReadyAt,
  historicalPrepMinutesFromOrders,
};
