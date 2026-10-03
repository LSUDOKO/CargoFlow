-- Alert subscriptions: a shipment party asks to be told when chain events move their shipment. The target is a
-- webhook URL, an email address, or a Telegram chat id once the subscriber has pressed Start on the bot link.
CREATE TABLE alert_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    address     TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
    channel     TEXT NOT NULL CHECK (channel IN ('webhook', 'telegram', 'email')),
    target      TEXT NOT NULL DEFAULT '' CHECK (length(target) <= 512),
    secret      TEXT NOT NULL DEFAULT '', -- webhook HMAC key, shown to the subscriber once
    events      TEXT[] NOT NULL CHECK (cardinality(events) > 0),
    active      BOOLEAN NOT NULL DEFAULT true,
    link_code   TEXT UNIQUE, -- Telegram start code until the chat is linked
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alert_subscriptions_by_shipment ON alert_subscriptions (shipment_id) WHERE active;
CREATE INDEX alert_subscriptions_by_address ON alert_subscriptions (shipment_id, address);

-- One row per (subscription, chain event): it makes delivery idempotent when the indexer redelivers an event.
CREATE TABLE alert_deliveries (
    subscription_id UUID NOT NULL REFERENCES alert_subscriptions (id) ON DELETE CASCADE,
    event_key       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts        INT NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subscription_id, event_key)
);
