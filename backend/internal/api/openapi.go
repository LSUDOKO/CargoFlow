package api

//go:generate go run ../../cmd/openapi -out ../../openapi.json

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The OpenAPI 3.1 document is generated from the route table (routes.go): every route names its request and response
// Go types, and the generator reflects their JSON tags into schemas. TestOpenAPISpecIsCurrent fails when the committed
// backend/openapi.json differs from what the code produces, so the published docs cannot drift from the handlers.

// SpecVersion is the API version reported in the document.
const SpecVersion = "1.1.0"

var (
	specOnce  sync.Once
	specBytes []byte
	specErr   error
)

// OpenAPIJSON returns the generated OpenAPI document, indented, with a trailing newline (exactly the committed file).
func OpenAPIJSON() ([]byte, error) {
	specOnce.Do(func() {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		specErr = enc.Encode(buildSpec((&Server{}).routes()))
		specBytes = buf.Bytes()
	})
	return specBytes, specErr
}

func (s *Server) openapi(w http.ResponseWriter, _ *http.Request) error {
	b, err := OpenAPIJSON()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(b)
	return nil
}

type authKind int

const (
	authNone    authKind = iota
	authAdmin            // X-API-Key
	authWallet           // an EIP-191 personal_sign authorization in the body
	authSource           // a registered evidence source signs the request (headers)
	authWebhook          // Alchemy signs the raw body (X-Alchemy-Signature)
)

// param documents one query parameter.
type param struct {
	Name, Description string
	Required          bool
	Schema            map[string]any // default {"type":"string"}
}

// route is one endpoint: its handler and everything the OpenAPI document says about it.
type route struct {
	Method, Path string
	ID           string // operationId
	Summary      string
	Description  string
	Tag          string
	Auth         authKind
	Signed       string // authWallet: the exact message the wallet signs
	Query        []param
	Request      any            // zero value of the JSON body type; nil for none
	Response     any            // zero value of the success body type
	Status       int            // success status; default 200
	Also         map[int]string // further documented statuses (beyond the error default)
	ContentType  string         // success content type; default application/json

	h   handlerFunc
	raw func(*Server) http.Handler // for routes that are not handlerFuncs (WebSocket)
}

func (rt route) status() int {
	if rt.Status == 0 {
		return http.StatusOK
	}
	return rt.Status
}

var pathParam = regexp.MustCompile(`\{([a-zA-Z]+)\}`)

// pathParamDocs describes the path parameters used across the API.
var pathParamDocs = map[string]string{
	"secret":  "the ZERODEV_WEBHOOK_SECRET path secret (the only credential ZeroDev sends); a wrong or unset secret answers 404",
	"id":      "shipment id: 0x followed by 64 lowercase hex characters (keccak256(exporter, keccak256(externalRef)))",
	"sid":     "alert subscription id (uuid)",
	"rid":     "financing request id (uuid)",
	"address": "a 0x address",
	"tokenId": "the bill's ERC-721 token id (decimal)",
	"keyHash": "device key hash: 0x + hex keccak256 of the device's public key bytes (raw 32-byte Ed25519 key, or the 65-byte uncompressed P-256 point)",
}

const errorSchemaName = "Error"

type errorDoc struct {
	Error struct {
		Code    string `json:"code" doc:"stable machine-readable code, e.g. invalid_request, unauthorized, replayed, chain_rejected"`
		Message string `json:"message" doc:"human-readable explanation; never contains internal detail"`
	} `json:"error"`
}

func buildSpec(routes []route) map[string]any {
	g := newSchemaGen()
	g.schema(reflect.TypeOf(errorDoc{}), errorSchemaName)
	paths := map[string]map[string]any{}
	for _, rt := range routes {
		op := map[string]any{
			"operationId": rt.ID,
			"summary":     rt.Summary,
			"tags":        []string{rt.Tag},
		}
		desc := rt.Description
		var params []map[string]any
		for _, m := range pathParam.FindAllStringSubmatch(rt.Path, -1) {
			params = append(params, map[string]any{"name": m[1], "in": "path", "required": true,
				"description": pathParamDocs[m[1]], "schema": map[string]any{"type": "string"}})
		}
		for _, q := range rt.Query {
			sch := q.Schema
			if sch == nil {
				sch = map[string]any{"type": "string"}
			}
			params = append(params, map[string]any{"name": q.Name, "in": "query", "required": q.Required, "description": q.Description, "schema": sch})
		}
		switch rt.Auth {
		case authAdmin:
			op["security"] = []map[string][]string{{"adminKey": {}}}
		case authSource:
			op["security"] = []map[string][]string{{"sourceSignature": {}}}
			for _, h := range sourceHeaders {
				params = append(params, map[string]any{"name": h[0], "in": "header", "required": h[2] == "required", "description": h[1], "schema": map[string]any{"type": "string"}})
			}
			desc = strings.TrimSpace(desc + "\n\n" + sourceSigningDoc)
		case authWebhook:
			op["security"] = []map[string][]string{{"alchemySignature": {}}}
			params = append(params, map[string]any{"name": "X-Alchemy-Signature", "in": "header", "required": true,
				"description": "hex HMAC-SHA256 of the raw body with the webhook's signing key", "schema": map[string]any{"type": "string"}})
		case authWallet:
			op["security"] = []map[string][]string{{"walletSignature": {}}}
			op["x-cargoflow-signed-message"] = rt.Signed
			desc = strings.TrimSpace(desc + "\n\nSigned by a wallet (EIP-191 personal_sign, or EIP-1271 for contract wallets) over this exact text, " +
				"lines joined by \\n with no trailing newline, ids and addresses lower case; `issued` is unix seconds within 10 minutes " +
				"of the server clock, and each authorization is single-use (409 `replayed`):\n\n```\n" + rt.Signed + "\n```")
		default:
			op["security"] = []map[string][]string{}
		}
		if desc != "" {
			op["description"] = desc
		}
		if len(params) > 0 {
			op["parameters"] = params
		}
		if rt.Request != nil {
			op["requestBody"] = map[string]any{"required": true, "content": map[string]any{
				"application/json": map[string]any{"schema": g.schema(reflect.TypeOf(rt.Request), "")}}}
		}
		responses := map[string]any{}
		success := map[string]any{"description": http.StatusText(rt.status())}
		if rt.Response != nil {
			ct := rt.ContentType
			if ct == "" {
				ct = "application/json"
			}
			success["content"] = map[string]any{ct: map[string]any{"schema": g.schema(reflect.TypeOf(rt.Response), "")}}
		}
		responses[strconv.Itoa(rt.status())] = success
		for code, d := range rt.Also {
			responses[strconv.Itoa(code)] = map[string]any{"description": d}
		}
		responses["default"] = map[string]any{"description": "error", "content": map[string]any{
			"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + errorSchemaName}}}}
		op["responses"] = responses
		if paths[rt.Path] == nil {
			paths[rt.Path] = map[string]any{}
		}
		paths[rt.Path][strings.ToLower(rt.Method)] = op
	}
	return map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":       "CargoFlow API",
			"version":     SpecVersion,
			"description": specIntro,
			"license":     map[string]any{"name": "Apache-2.0", "identifier": "Apache-2.0"},
		},
		"servers": []map[string]any{{"url": "/", "description": "this backend"}},
		"paths":   paths,
		"components": map[string]any{
			"schemas": g.defs,
			"securitySchemes": map[string]any{
				"adminKey": map[string]any{"type": "apiKey", "in": "header", "name": "X-API-Key", "description": "the operator's ADMIN_API_KEY"},
				"walletSignature": map[string]any{"type": "apiKey", "in": "header", "name": "X-Wallet-Signature",
					"description": "Not a header: the body carries `issuedAt` and `signature` (hex EIP-191 personal_sign) over the operation's " +
						"`x-cargoflow-signed-message`. Declared as a scheme so clients can see which operations need a wallet."},
				"sourceSignature": map[string]any{"type": "apiKey", "in": "header", "name": "X-Signature", "description": sourceSigningDoc},
				"alchemySignature": map[string]any{"type": "apiKey", "in": "header", "name": "X-Alchemy-Signature",
					"description": "Alchemy Notify: hex HMAC-SHA256 of the raw request body with the webhook's signing key (ALCHEMY_WEBHOOK_SIGNING_KEYS)"},
			},
		},
	}
}

var sourceHeaders = [][3]string{
	{"X-Source-Id", "the evidence source id returned at registration", "required"},
	{"X-Timestamp", "unix seconds, within 5 minutes of the server clock", "required"},
	{"X-Signature", "base64url (unpadded) signature: Ed25519 (64 bytes), P-256 ECDSA (ASN.1 DER or raw r||s), or for WebAuthn the authenticator's DER signature", "required"},
	{"X-WebAuthn-Authenticator-Data", "WebAuthn sources only: base64url authenticatorData from the assertion", "optional"},
	{"X-WebAuthn-Client-Data", "WebAuthn sources only: base64url clientDataJSON from the assertion", "optional"},
}

const sourceSigningDoc = "Signed by a registered evidence source. The signing string is\n\n" +
	"```\nCARGOFLOW-V1\\n<METHOD>\\n<PATH>\\n<TIMESTAMP>\\n<hex sha256(body)>\n```\n\n" +
	"`ed25519` sources sign it with Ed25519. `p256` sources sign it with ECDSA P-256 over SHA-256 (X-Signature is the DER " +
	"or raw 64-byte r||s signature). `webauthn` sources run navigator.credentials.get with challenge = sha256(signing string) " +
	"(32 raw bytes) and send the assertion: X-Signature = signature, X-WebAuthn-Authenticator-Data = authenticatorData, " +
	"X-WebAuthn-Client-Data = clientDataJSON (all base64url); the backend checks type `webauthn.get`, the challenge, the " +
	"registered RP id hash, the user-present flag and the signature over authenticatorData || sha256(clientDataJSON)."

const specIntro = "CargoFlow turns signed shipment telemetry into on-chain financing decisions. Public reads need no credentials. " +
	"Writes are authenticated in one of three ways: the operator's admin key, a party's wallet signature over a fixed message " +
	"(see each operation's `x-cargoflow-signed-message`), or an evidence source's request signature (Ed25519, P-256 or WebAuthn). " +
	"Errors are `{\"error\": {\"code\", \"message\"}}` with stable codes. Amounts are USDG base units (6 decimals) as decimal strings."

// schemaGen reflects Go types into JSON Schema (OpenAPI 3.1 dialect) and collects named structs as components.
type schemaGen struct {
	defs  map[string]any
	names map[reflect.Type]string
	taken map[string]reflect.Type
}

func newSchemaGen() *schemaGen {
	return &schemaGen{defs: map[string]any{}, names: map[reflect.Type]string{}, taken: map[string]reflect.Type{}}
}

var (
	timeType    = reflect.TypeOf(time.Time{})
	rawJSONType = reflect.TypeOf(json.RawMessage{})
	durType     = reflect.TypeOf(time.Duration(0))
)

// schemaNamer lets a type name its own schema component.
type schemaNamer interface{ SchemaName() string }

// componentName picks a stable, unique component name for a named type.
func (g *schemaGen) componentName(t reflect.Type, want string) string {
	if n, ok := g.names[t]; ok {
		return n
	}
	name := want
	if name == "" {
		if sn, ok := reflect.Zero(t).Interface().(schemaNamer); ok {
			name = sn.SchemaName()
		} else {
			name = exported(t.Name())
		}
	}
	if other, ok := g.taken[name]; ok && other != t {
		pkg := t.PkgPath()
		name = exported(pkg[strings.LastIndex(pkg, "/")+1:]) + name
	}
	g.names[t] = name
	g.taken[name] = t
	return name
}

func exported(s string) string {
	if s == "" {
		return s
	}
	s = strings.TrimSuffix(strings.TrimSuffix(s, "DTO"), "Body")
	return strings.ToUpper(s[:1]) + s[1:]
}

func (g *schemaGen) schema(t reflect.Type, name string) map[string]any {
	switch {
	case t == timeType:
		return map[string]any{"type": "string", "format": "date-time"}
	case t == rawJSONType:
		return map[string]any{}
	case t == durType:
		return map[string]any{"type": "integer", "description": "nanoseconds"}
	}
	switch t.Kind() {
	case reflect.Pointer:
		inner := g.schema(t.Elem(), "")
		return map[string]any{"anyOf": []any{inner, map[string]any{"type": "null"}}}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return map[string]any{"type": "integer"}
	case reflect.Float32, reflect.Float64:
		return map[string]any{"type": "number"}
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Interface:
		return map[string]any{}
	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 && t.Kind() == reflect.Slice {
			return map[string]any{"type": "string", "contentEncoding": "base64"}
		}
		out := map[string]any{"type": "array", "items": g.schema(t.Elem(), "")}
		if t.Kind() == reflect.Array {
			out["minItems"], out["maxItems"] = t.Len(), t.Len()
		}
		return out
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": g.schema(t.Elem(), "")}
	case reflect.Struct:
		if t.Name() == "" {
			return g.structSchema(t)
		}
		cname := g.componentName(t, name)
		if _, done := g.defs[cname]; !done {
			g.defs[cname] = map[string]any{} // placeholder breaks recursion
			g.defs[cname] = g.structSchema(t)
		}
		return map[string]any{"$ref": "#/components/schemas/" + cname}
	}
	panic(fmt.Sprintf("openapi: unsupported type %s", t))
}

func (g *schemaGen) structSchema(t reflect.Type) map[string]any {
	props := map[string]any{}
	var required []string
	g.fields(t, props, &required)
	out := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		sort.Strings(required)
		out["required"] = required
	}
	return out
}

func (g *schemaGen) fields(t reflect.Type, props map[string]any, required *[]string) {
	for i := range t.NumField() {
		f := t.Field(i)
		tag := f.Tag.Get("json")
		if tag == "-" {
			continue
		}
		name, opts, _ := strings.Cut(tag, ",")
		if f.Anonymous && name == "" {
			ft := f.Type
			if ft.Kind() == reflect.Pointer {
				ft = ft.Elem()
			}
			if ft.Kind() == reflect.Struct {
				g.fields(ft, props, required)
				continue
			}
		}
		if !f.IsExported() {
			continue
		}
		if name == "" {
			name = f.Name
		}
		var sch map[string]any
		if strings.Contains(","+opts+",", ",string,") {
			sch = map[string]any{"type": "string"}
		} else {
			sch = g.schema(f.Type, "")
		}
		if d := f.Tag.Get("doc"); d != "" {
			if _, isRef := sch["$ref"]; isRef {
				sch = map[string]any{"allOf": []any{sch}, "description": d}
			} else {
				cp := make(map[string]any, len(sch)+1)
				for k, v := range sch {
					cp[k] = v
				}
				cp["description"] = d
				sch = cp
			}
		}
		if e := f.Tag.Get("enum"); e != "" {
			sch["enum"] = strings.Split(e, ",")
		}
		props[name] = sch
		optional := strings.Contains(","+opts+",", ",omitempty,") || strings.Contains(","+opts+",", ",omitzero,") || f.Tag.Get("optional") == "true"
		if !optional {
			*required = append(*required, name)
		}
	}
}

func reflectTypeOf[T any]() reflect.Type { return reflect.TypeOf((*T)(nil)).Elem() }
