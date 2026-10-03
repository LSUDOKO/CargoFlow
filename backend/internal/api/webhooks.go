package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

// maxWebhookBody bounds an Alchemy delivery (a block's worth of our logs is far smaller).
const maxWebhookBody = 1 << 20

// IndexerWaker is the part of the chain indexer the webhook needs: whether an address is one of ours, and a
// non-blocking request to sync now.
type IndexerWaker interface {
	Watches(addr common.Address) bool
	Wake(block uint64) bool
}

// alchemyWebhookDoc documents the deliveries accepted (Custom Webhook / GraphQL, and Address Activity); the handler
// reads them leniently and uses only the block number and the emitting addresses.
type alchemyWebhookDoc struct {
	WebhookID string `json:"webhookId" doc:"the webhook's id, e.g. wh_..."`
	ID        string `json:"id" doc:"the delivery id, e.g. whevt_...; a repeat within 24 hours is ignored"`
	CreatedAt string `json:"createdAt,omitempty" optional:"true"`
	Type      string `json:"type" doc:"GRAPHQL or ADDRESS_ACTIVITY" enum:"GRAPHQL,ADDRESS_ACTIVITY"`
	Event     struct {
		Data *struct {
			Block struct {
				Number int64 `json:"number"`
				Logs   []struct {
					Account struct {
						Address string `json:"address"`
					} `json:"account"`
					Topics      []string `json:"topics"`
					Transaction struct {
						Hash string `json:"hash"`
					} `json:"transaction"`
				} `json:"logs"`
			} `json:"block"`
		} `json:"data,omitempty" optional:"true" doc:"Custom Webhook (GRAPHQL) payload"`
		Activity []struct {
			BlockNum    string `json:"blockNum" doc:"hex block number"`
			FromAddress string `json:"fromAddress"`
			ToAddress   string `json:"toAddress"`
			Hash        string `json:"hash"`
			RawContract struct {
				Address string `json:"address"`
			} `json:"rawContract"`
		} `json:"activity,omitempty" optional:"true" doc:"Address Activity payload"`
	} `json:"event"`
}

type webhookResult struct {
	Accepted  bool   `json:"accepted"`
	Duplicate bool   `json:"duplicate,omitempty" doc:"the delivery id was seen in the last 24 hours; nothing was done"`
	Matched   int    `json:"matched" doc:"logs or activities from CargoFlow contracts"`
	Block     uint64 `json:"block,omitempty" doc:"the highest block among them"`
	Woken     bool   `json:"woken" doc:"the indexer was asked to sync now (it re-reads the logs from the RPC; the payload itself is never applied)"`
}

// alchemyPayload is the lenient decoding of a delivery.
type alchemyPayload struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Event struct {
		Data *struct {
			Block struct {
				Number       json.RawMessage `json:"number"`
				Logs         []alchemyLog    `json:"logs"`
				Transactions []struct {
					Logs []alchemyLog `json:"logs"`
				} `json:"transactions"`
			} `json:"block"`
		} `json:"data"`
		Activity []struct {
			BlockNum    string `json:"blockNum"`
			ToAddress   string `json:"toAddress"`
			RawContract struct {
				Address string `json:"address"`
			} `json:"rawContract"`
			Log *struct {
				Address     string `json:"address"`
				BlockNumber string `json:"blockNumber"`
			} `json:"log"`
		} `json:"activity"`
	} `json:"event"`
}

type alchemyLog struct {
	Account struct {
		Address string `json:"address"`
	} `json:"account"`
	Transaction struct {
		Logs []alchemyLog `json:"logs"`
	} `json:"transaction"`
}

// validAlchemySignature checks X-Alchemy-Signature (hex HMAC-SHA256 of the raw body) against every configured key
// in constant time.
func validAlchemySignature(keys []string, body []byte, header string) bool {
	got, err := hex.DecodeString(strings.TrimSpace(header))
	if err != nil || len(got) != sha256.Size {
		return false
	}
	ok := false
	for _, k := range keys {
		m := hmac.New(sha256.New, []byte(k))
		m.Write(body)
		if hmac.Equal(m.Sum(nil), got) {
			ok = true
		}
	}
	return ok
}

// parseBlock reads a block number given as a JSON number, a decimal string or a 0x hex string.
func parseBlock(raw string) (uint64, bool) {
	raw = strings.Trim(strings.TrimSpace(raw), `"`)
	if raw == "" || raw == "null" {
		return 0, false
	}
	if strings.HasPrefix(raw, "0x") || strings.HasPrefix(raw, "0X") {
		n, err := strconv.ParseUint(raw[2:], 16, 64)
		return n, err == nil
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	return n, err == nil
}

func (s *Server) alchemyWebhook(w http.ResponseWriter, r *http.Request) error {
	if len(s.c.AlchemySigningKeys) == 0 || s.c.Indexer == nil {
		return &Error{http.StatusServiceUnavailable, "webhook_unavailable", "Alchemy webhooks are not configured"}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebhookBody))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return &Error{http.StatusRequestEntityTooLarge, "too_large", "the delivery exceeds 1 MB"}
		}
		return ErrBadRequest("could not read the body")
	}
	sig := r.Header.Get("X-Alchemy-Signature")
	if sig == "" {
		return ErrUnauthorized("X-Alchemy-Signature is required")
	}
	if !validAlchemySignature(s.c.AlchemySigningKeys, body, sig) {
		return &Error{http.StatusUnauthorized, "invalid_signature", "the signature does not match any signing key"}
	}
	var p alchemyPayload
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&p); err != nil {
		return ErrBadRequest("the delivery is not a JSON object")
	}
	if p.ID == "" {
		return ErrBadRequest("the delivery has no id")
	}
	fresh, err := s.c.Store.ClaimWebhookDelivery(r.Context(), "alchemy", p.ID)
	if err != nil {
		return err
	}
	if !fresh {
		writeJSON(w, http.StatusOK, webhookResult{Accepted: false, Duplicate: true})
		return nil
	}

	out := webhookResult{Accepted: true}
	match := func(addr string, block uint64) {
		if !common.IsHexAddress(addr) || !s.c.Indexer.Watches(common.HexToAddress(addr)) {
			return
		}
		out.Matched++
		out.Block = max(out.Block, block)
	}
	if d := p.Event.Data; d != nil {
		block, _ := parseBlock(string(d.Block.Number))
		var walk func([]alchemyLog)
		walk = func(logs []alchemyLog) {
			for _, l := range logs {
				match(l.Account.Address, block)
				walk(l.Transaction.Logs)
			}
		}
		walk(d.Block.Logs)
		for _, tx := range d.Block.Transactions {
			walk(tx.Logs)
		}
	}
	for _, a := range p.Event.Activity {
		block, _ := parseBlock(a.BlockNum)
		addrs := []string{a.RawContract.Address, a.ToAddress}
		if a.Log != nil {
			addrs = append(addrs, a.Log.Address)
			if block == 0 {
				block, _ = parseBlock(a.Log.BlockNumber)
			}
		}
		for _, addr := range addrs {
			before := out.Matched
			match(addr, block)
			if out.Matched > before {
				break // count each activity once
			}
		}
	}
	if out.Matched > 0 {
		s.c.Indexer.Wake(out.Block)
		out.Woken = true
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}
