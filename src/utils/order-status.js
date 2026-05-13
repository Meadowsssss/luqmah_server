const { ORDER_STATUSES } = require("../constants/enums");

const ALLOWED_STATUS_TRANSITIONS = {
  [ORDER_STATUSES.ACCEPTED]: [
    ORDER_STATUSES.IN_PROGRESS,
    ORDER_STATUSES.CANCELLED,
  ],
  [ORDER_STATUSES.IN_PROGRESS]: [
    ORDER_STATUSES.READY,
    ORDER_STATUSES.CANCELLED,
  ],
  [ORDER_STATUSES.READY]: [
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.CANCELLED,
  ],
  [ORDER_STATUSES.COMPLETED]: [],
  [ORDER_STATUSES.CANCELLED]: [],
};

const canTransitionOrderStatus = (fromStatus, toStatus) =>
  ALLOWED_STATUS_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;

module.exports = { ALLOWED_STATUS_TRANSITIONS, canTransitionOrderStatus };
