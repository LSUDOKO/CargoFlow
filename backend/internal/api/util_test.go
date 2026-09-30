package api_test

import (
	"context"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"strconv"
)

func ctxBG() context.Context { return context.Background() }
func itoa(n int64) string    { return strconv.FormatInt(n, 10) }
func signWith(e *env, path string, body []byte, ts int64) string {
	return authSign(e, path, body, ts)
}

func authSign(e *env, path string, body []byte, ts int64) string {
	return auth.Sign(e.sourcePriv, "POST", path, ts, body)
}
