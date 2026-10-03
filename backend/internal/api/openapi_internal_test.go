package api

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestEveryRouteIsDocumented fails when a route lacks what its OpenAPI entry needs. Handler serves only the route
// table, so a route cannot exist without an entry, and the document is built from the same table, so no entry can
// exist without a route.
func TestEveryRouteIsDocumented(t *testing.T) {
	seenID, seenRoute := map[string]bool{}, map[string]bool{}
	for _, rt := range (&Server{}).routes() {
		key := rt.Method + " " + rt.Path
		switch {
		case rt.ID == "" || rt.Summary == "" || rt.Tag == "":
			t.Errorf("%s: needs an operation id, a summary and a tag", key)
		case rt.Response == nil && rt.raw == nil:
			t.Errorf("%s: needs a response type", key)
		case rt.h == nil && rt.raw == nil:
			t.Errorf("%s: has no handler", key)
		case rt.Auth == authWallet && !strings.Contains(rt.Signed, "issued: <t>"):
			t.Errorf("%s: a wallet-signed route must document its signed message", key)
		case rt.Auth != authWallet && rt.Signed != "":
			t.Errorf("%s: only wallet-signed routes carry a signed message", key)
		case (rt.Method == "POST" || rt.Method == "DELETE") && rt.Request == nil && rt.Auth != authAdmin:
			t.Errorf("%s: a public or signed write must document its request body", key)
		}
		if seenID[rt.ID] || seenRoute[key] {
			t.Errorf("%s: duplicate operation id or route", key)
		}
		seenID[rt.ID], seenRoute[key] = true, true
	}

	var spec struct {
		Paths map[string]map[string]any `json:"paths"`
	}
	b, err := OpenAPIJSON()
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &spec); err != nil {
		t.Fatal(err)
	}
	n := 0
	for path, ops := range spec.Paths {
		for method := range ops {
			n++
			if !seenRoute[strings.ToUpper(method)+" "+path] {
				t.Errorf("the document lists %s %s, which has no route", method, path)
			}
		}
	}
	if n != len(seenRoute) {
		t.Errorf("the document has %d operations for %d routes", n, len(seenRoute))
	}
}

// TestOpenAPISpecIsCurrent fails when backend/openapi.json is not what the code generates. Regenerate with
// `go generate ./internal/api` (or UPDATE_OPENAPI=1 go test ./internal/api -run OpenAPISpecIsCurrent).
func TestOpenAPISpecIsCurrent(t *testing.T) {
	want, err := OpenAPIJSON()
	if err != nil {
		t.Fatal(err)
	}
	const path = "../../openapi.json"
	if os.Getenv("UPDATE_OPENAPI") == "1" {
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the committed document: %v (run `go generate ./internal/api`)", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("backend/openapi.json is stale: run `go generate ./internal/api` and commit the result")
	}
}

func TestSchemasFollowJSONTags(t *testing.T) {
	g := newSchemaGen()
	type inner struct {
		A int `json:"a"`
	}
	type sample struct {
		inner
		Name     string            `json:"name" doc:"the name"`
		Optional string            `json:"optional,omitempty"`
		Hidden   string            `json:"-"`
		Ptr      *inner            `json:"ptr"`
		Tags     []string          `json:"tags"`
		Labels   map[string]int    `json:"labels"`
		Pair     [2]string         `json:"pair"`
		Raw      json.RawMessage   `json:"raw"`
		Num      int64             `json:"num,string"`
		Nested   map[string]*inner `json:"nested,omitzero"`
	}
	ref := g.schema(reflectTypeOf[sample](), "")
	if ref["$ref"] != "#/components/schemas/Sample" {
		t.Fatalf("named structs become components: %v", ref)
	}
	s := g.defs["Sample"].(map[string]any)
	props := s["properties"].(map[string]any)
	for _, want := range []string{"a", "name", "optional", "ptr", "tags", "labels", "pair", "raw", "num", "nested"} {
		if _, ok := props[want]; !ok {
			t.Errorf("missing property %q", want)
		}
	}
	if _, ok := props["Hidden"]; ok {
		t.Error("json:\"-\" fields are not documented")
	}
	if props["num"].(map[string]any)["type"] != "string" {
		t.Error(",string fields are strings")
	}
	if props["name"].(map[string]any)["description"] != "the name" {
		t.Error("doc tags become descriptions")
	}
	req := strings.Join(toStrings(s["required"]), ",")
	if strings.Contains(req, "optional") || strings.Contains(req, "nested") || !strings.Contains(req, "name") || !strings.Contains(req, "a") {
		t.Errorf("required = %s", req)
	}
}

func toStrings(v any) []string {
	out, _ := v.([]string)
	return out
}
