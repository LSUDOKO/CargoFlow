-- Wallet-signed authorizations that have been used. Each one is single-use: the digest (of the signer and the signed
-- message) is remembered until the authorization could no longer pass its time window.
CREATE TABLE used_authorizations (
    digest     TEXT PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX used_authorizations_by_expiry ON used_authorizations (expires_at);
