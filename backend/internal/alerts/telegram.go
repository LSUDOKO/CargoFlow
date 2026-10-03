package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// DefaultTelegramBaseURL is the Bot API endpoint.
const DefaultTelegramBaseURL = "https://api.telegram.org"

// Telegram sends alerts through a Telegram bot and links chats to subscriptions: a subscriber opens
// https://t.me/<bot>?start=<code> and presses Start, which reaches the bot as "/start <code>".
type Telegram struct {
	token config.Secret
	base  string
	http  *http.Client
	Log   *slog.Logger
}

// NewTelegram builds the client. An empty baseURL selects the public Bot API.
func NewTelegram(token config.Secret, baseURL string) *Telegram {
	if baseURL == "" {
		baseURL = DefaultTelegramBaseURL
	}
	return &Telegram{token: token, base: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 60 * time.Second}, Log: slog.Default()}
}

// call invokes a Bot API method and decodes its result into out. The token never appears in a returned error.
func (t *Telegram) call(ctx context.Context, method string, params any, out any) error {
	var body io.Reader
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.base+"/bot"+t.token.Reveal()+"/"+method, body)
	if err != nil {
		return errors.New("telegram: bad request")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.http.Do(req)
	if err != nil {
		return fmt.Errorf("telegram %s: %s", method, t.redact(err.Error()))
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("telegram %s: %s", method, t.redact(err.Error()))
	}
	var env struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("telegram %s: status %d, not JSON", method, resp.StatusCode)
	}
	if !env.OK {
		return fmt.Errorf("telegram %s: %s", method, t.redact(oneLine(env.Description, 200)))
	}
	if out != nil {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

func (t *Telegram) redact(s string) string {
	if k := t.token.Reveal(); k != "" {
		s = strings.ReplaceAll(s, k, "[redacted]")
	}
	return s
}

// BotUsername asks the Bot API who the bot is (getMe), for the t.me link.
func (t *Telegram) BotUsername(ctx context.Context) (string, error) {
	var me struct {
		Username string `json:"username"`
	}
	if err := t.call(ctx, "getMe", nil, &me); err != nil {
		return "", err
	}
	if me.Username == "" {
		return "", errors.New("telegram getMe: the bot has no username")
	}
	return me.Username, nil
}

// SendText sends a plain-text message to a chat.
func (t *Telegram) SendText(ctx context.Context, chatID, text string) error {
	return t.call(ctx, "sendMessage", map[string]any{"chat_id": chatID, "text": text, "disable_web_page_preview": true}, nil)
}

// Send delivers an alert to the subscription's linked chat.
func (t *Telegram) Send(ctx context.Context, sub store.Subscription, a Alert) error {
	return t.SendText(ctx, sub.Target, Text(a))
}

// Linker links a start code to a chat and returns the reply to send.
type Linker func(ctx context.Context, code, chatID string) string

// LinkTelegram is the Linker backed by the store.
func LinkTelegram(st *store.Store) Linker {
	return func(ctx context.Context, code, chatID string) string {
		sub, err := st.LinkTelegram(ctx, code, chatID)
		if err != nil {
			return "This link has expired or was already used. Create a new Telegram alert in CargoFlow."
		}
		ref := sub.ShipmentID
		if sh, err := st.GetShipment(ctx, sub.ShipmentID); err == nil && sh.ExternalRef != "" {
			ref = oneLine(sh.ExternalRef, 80)
		}
		return fmt.Sprintf("CargoFlow alerts are on for shipment %s: %s.", ref, strings.Join(sub.Events, ", "))
	}
}

// Listen long-polls the Bot API for "/start <code>" messages until ctx is cancelled, linking each code through
// link and replying with its answer. Network failures are retried with a pause.
func (t *Telegram) Listen(ctx context.Context, link Linker) error {
	offset := 0
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var updates []struct {
			UpdateID int `json:"update_id"`
			Message  *struct {
				Text string `json:"text"`
				Chat struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			} `json:"message"`
		}
		err := t.call(ctx, "getUpdates", map[string]any{"offset": offset, "timeout": 30, "allowed_updates": []string{"message"}}, &updates)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			t.Log.Warn("telegram polling failed; retrying", "err", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
			}
			continue
		}
		for _, u := range updates {
			offset = max(offset, u.UpdateID+1)
			if u.Message == nil {
				continue
			}
			code, ok := strings.CutPrefix(strings.TrimSpace(u.Message.Text), "/start ")
			if !ok {
				continue
			}
			chat := strconv.FormatInt(u.Message.Chat.ID, 10)
			if err := t.SendText(ctx, chat, link(ctx, strings.TrimSpace(code), chat)); err != nil {
				t.Log.Warn("telegram reply failed", "err", err)
			}
		}
	}
}
