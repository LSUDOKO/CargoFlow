// Command openapi writes the CargoFlow API's OpenAPI 3.1 document, generated from the route table in internal/api.
//
//	go run ./cmd/openapi -out openapi.json     (or: go generate ./internal/api)
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
)

func main() {
	out := flag.String("out", "openapi.json", "where to write the document; - for stdout")
	flag.Parse()
	b, err := api.OpenAPIJSON()
	if err != nil {
		fmt.Fprintln(os.Stderr, "openapi:", err)
		os.Exit(1)
	}
	if *out == "-" {
		_, _ = os.Stdout.Write(b)
		return
	}
	if err := os.WriteFile(*out, b, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "openapi:", err)
		os.Exit(1)
	}
}
