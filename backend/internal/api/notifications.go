package api

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

type notificationList struct {
	Notifications []store.Notification `json:"notifications"`
	Unread        int                  `json:"unread"`
}

type notificationsReadBody struct {
	Address   string   `json:"address"`
	IDs       []string `json:"ids,omitempty" doc:"notification ids to mark read; omit (or empty) to mark all read. At most 100."`
	IssuedAt  int64    `json:"issuedAt"`
	Signature string   `json:"signature"`
}

type notificationsReadResult struct {
	Marked int `json:"marked"`
	Unread int `json:"unread"`
}

// notifications lists a wallet's in-app notifications, newest first.
func (s *Server) notifications(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	address := strings.ToLower(strings.TrimSpace(q.Get("address")))
	if !addressPattern.MatchString(address) {
		return ErrBadRequest("address must be a 0x address")
	}
	limit := 50
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxListLimit {
			return ErrBadRequest(fmt.Sprintf("limit must be between 1 and %d", maxListLimit))
		}
		limit = n
	}
	list, unread, err := s.c.Store.Notifications(r.Context(), address, limit, q.Get("unread") == "true")
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, notificationList{Notifications: list, Unread: unread})
	return nil
}

// readNotifications marks a wallet's notifications read; only that wallet can.
func (s *Server) readNotifications(w http.ResponseWriter, r *http.Request) error {
	var body notificationsReadBody
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	address := strings.ToLower(strings.TrimSpace(body.Address))
	if !addressPattern.MatchString(address) {
		return ErrBadRequest("address must be a 0x address")
	}
	if len(body.IDs) > 100 {
		return ErrBadRequest("at most 100 ids at a time")
	}
	ids := make([]string, len(body.IDs))
	for i, id := range body.IDs {
		ids[i] = strings.ToLower(strings.TrimSpace(id))
		if !uuidPattern.MatchString(ids[i]) {
			return ErrBadRequest("ids are notification ids")
		}
	}
	signed := "all"
	if len(ids) > 0 {
		signed = strings.Join(ids, ",")
	}
	if _, err := s.walletSigner(r.Context(), auth.NotificationsReadAuthorization(address, signed, body.IssuedAt), body.Signature, body.IssuedAt,
		"only the notified wallet can mark its notifications read", address); err != nil {
		return err
	}
	n, err := s.c.Store.MarkNotificationsRead(r.Context(), address, slices.Compact(ids), s.now())
	if err != nil {
		return err
	}
	_, unread, err := s.c.Store.Notifications(r.Context(), address, 1, true)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, notificationsReadResult{Marked: n, Unread: unread})
	return nil
}
