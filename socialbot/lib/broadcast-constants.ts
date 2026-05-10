/** Push `data.type` value that requires a persisted `notification_broadcasts.event_id`. */
export const NOTIFICATION_DATA_TYPE_EVENT_CAMPAIGN = 'event_campaign' as const;

/** Admin UI + API when `data.type` is `event_campaign` but `event_id` is missing or invalid. */
export const BROADCAST_EVENT_CAMPAIGN_REQUIRES_EVENT_MSG = 'Please select an event for event campaign';
