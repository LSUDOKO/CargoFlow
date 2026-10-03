package devicetrust

// ExportCBORDecode exposes the decoder to the external tests.
func ExportCBORDecode(b []byte) (any, error) {
	v, _, err := cborDecode(b)
	return v, err
}
