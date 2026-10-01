-- How many times a failed chain action has been put back in the queue. The reconciler uses it to back
-- off and eventually give up instead of retrying a permanently reverting transaction forever.
ALTER TABLE chain_actions ADD COLUMN attempts INT NOT NULL DEFAULT 0;
