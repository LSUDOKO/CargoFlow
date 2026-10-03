package store

import (
	"context"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SourceRef is the device behind one stored reading.
type SourceRef struct {
	KeyHash     string
	DeviceClass string
}

// ReadingSources maps each of a shipment's stored readings ("sensor|timestamp") to the device that submitted it.
// Readings from trusted local ingestion (no source) are absent.
func (s *Store) ReadingSources(ctx context.Context, shipmentID string) (map[string]SourceRef, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT tp.sensor_id, tp.ts, es.public_key, COALESCE(es.key_hash, ''), es.device_class
		FROM telemetry_points tp JOIN evidence_sources es ON es.source_id = tp.source_id
		WHERE tp.shipment_id = $1`, shipmentID)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	out := map[string]SourceRef{}
	for rows.Next() {
		var sensor, kh, class string
		var ts int64
		var pub []byte
		if err := rows.Scan(&sensor, &ts, &pub, &kh, &class); err != nil {
			return nil, err
		}
		if kh == "" {
			kh = KeyHash(pub)
		}
		out[sensor+"|"+strconv.FormatInt(ts, 10)] = SourceRef{KeyHash: kh, DeviceClass: class}
	}
	return out, rows.Err()
}

// EpochSourceRefs returns the distinct devices behind an epoch's readings, sorted by key hash.
func EpochSourceRefs(e EpochRecord, refs map[string]SourceRef) []SourceRef {
	seen := map[string]bool{}
	var out []SourceRef
	for _, p := range e.Points {
		r, ok := refs[p.SensorID+"|"+strconv.FormatInt(p.Timestamp, 10)]
		if !ok || seen[r.KeyHash] {
			continue
		}
		seen[r.KeyHash] = true
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].KeyHash < out[j].KeyHash })
	return out
}

// OnChainDevice is a device as DeviceRegistry's indexed events describe it.
type OnChainDevice struct {
	Registered  bool   `json:"registered"`
	DeviceClass string `json:"deviceClass" enum:"software,passkey,secure_element"`
	Revoked     bool   `json:"revoked"`
	TxHash      string `json:"txHash" doc:"the DeviceRegistered transaction"`
}

var deviceClassNames = map[float64]string{0: ClassSoftware, 1: ClassPasskey, 2: ClassSecureElement}

// DevicesOnChain folds the indexed DeviceRegistry events into the state of each device key hash.
func (s *Store) DevicesOnChain(ctx context.Context, keyHashes ...string) (map[string]OnChainDevice, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT event_name, args, tx_hash FROM chain_events
		WHERE contract = 'DeviceRegistry' AND event_name IN ('DeviceRegistered', 'DeviceRevoked')
		  AND (cardinality($1::text[]) = 0 OR lower(args->>'deviceKeyHash') = ANY($1))
		ORDER BY block_number, log_index`, lowerAll(keyHashes))
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	out := map[string]OnChainDevice{}
	for rows.Next() {
		var name, tx string
		var args map[string]any
		if err := rows.Scan(&name, &args, &tx); err != nil {
			return nil, err
		}
		kh, _ := args["deviceKeyHash"].(string)
		kh = strings.ToLower(kh)
		d := out[kh]
		switch name {
		case "DeviceRegistered":
			c, _ := args["deviceClass"].(float64)
			d = OnChainDevice{Registered: true, DeviceClass: deviceClassNames[c], TxHash: tx}
		case "DeviceRevoked":
			d.Revoked = true
		}
		out[kh] = d
	}
	return out, rows.Err()
}

func lowerAll(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = strings.ToLower(s)
	}
	return out
}

// Bill is an electronic bill of lading (EBLRegistry token) as the indexed events describe it.
type Bill struct {
	TokenID         string         `json:"tokenId"`
	DocumentHash    string         `json:"documentHash"`
	Issuer          string         `json:"issuer"`
	Shipper         string         `json:"shipper"`
	Consignee       string         `json:"consignee" doc:"0x0000… for a bill made out to order"`
	Holder          string         `json:"holder"`
	Status          string         `json:"status" enum:"ISSUED,SURRENDERED,VOID"`
	IssuedAt        time.Time      `json:"issuedAt"`
	ClosedAt        *time.Time     `json:"closedAt"`
	Transfers       int            `json:"transfers" doc:"endorsements after issue"`
	History         []BillTransfer `json:"history"`
	BoundShipmentID *string        `json:"boundShipmentId"`
}

// BillTransfer is one change of holder (issue included, from the zero address).
type BillTransfer struct {
	From   string    `json:"from"`
	To     string    `json:"to"`
	TxHash string    `json:"txHash"`
	At     time.Time `json:"at"`
}

const zeroAddress = "0x0000000000000000000000000000000000000000"

// Bills folds the indexed EBLRegistry and title-binding events into bills. tokenID "" returns every bill.
func (s *Store) Bills(ctx context.Context, tokenID string) ([]Bill, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT contract, event_name, args, tx_hash, created_at, COALESCE(shipment_id, '') FROM chain_events
		WHERE (contract = 'EBLRegistry' AND event_name IN ('BillIssued', 'Transfer', 'BillSurrendered', 'BillVoided')
		    OR contract = 'FinancingController' AND event_name IN ('TitleBound', 'TitleReleased'))
		  AND ($1 = '' OR args->>'tokenId' = $1)
		ORDER BY block_number, log_index`, tokenID)
	if err != nil {
		return nil, mapErr(err)
	}
	defer rows.Close()
	bills := map[string]*Bill{}
	var order []string
	for rows.Next() {
		var contract, name, tx, shipment string
		var args map[string]any
		var at time.Time
		if err := rows.Scan(&contract, &name, &args, &tx, &at, &shipment); err != nil {
			return nil, err
		}
		str := func(k string) string { v, _ := args[k].(string); return strings.ToLower(v) }
		id := str("tokenId")
		b := bills[id]
		if b == nil {
			b = &Bill{TokenID: id, History: []BillTransfer{}}
			bills[id] = b
			order = append(order, id)
		}
		switch name {
		case "BillIssued":
			b.DocumentHash, b.Issuer, b.Shipper, b.Consignee, b.Status, b.IssuedAt = str("documentHash"), str("issuer"), str("shipper"), str("consignee"), "ISSUED", at
		case "Transfer":
			b.History = append(b.History, BillTransfer{From: str("from"), To: str("to"), TxHash: tx, At: at})
			b.Holder = str("to")
			if str("from") != zeroAddress {
				b.Transfers++
			}
		case "BillSurrendered":
			b.Status, b.ClosedAt = "SURRENDERED", &at
		case "BillVoided":
			b.Status, b.ClosedAt = "VOID", &at
		case "TitleBound":
			sh := shipment
			b.BoundShipmentID = &sh
		case "TitleReleased":
			b.BoundShipmentID = nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Bill, 0, len(order))
	for _, id := range order {
		if bills[id].Status == "" {
			continue // a title event for a bill whose issue was not indexed
		}
		out = append(out, *bills[id])
	}
	sort.SliceStable(out, func(i, j int) bool { return bigLess(out[i].TokenID, out[j].TokenID) })
	return out, nil
}

func bigLess(a, b string) bool {
	x, _ := new(big.Int).SetString(a, 10)
	y, _ := new(big.Int).SetString(b, 10)
	if x == nil || y == nil {
		return a < b
	}
	return x.Cmp(y) < 0
}

// BillByDocument returns the issued bill whose document hash is documentHash (keccak256, 0x hex), if any.
func (s *Store) BillByDocument(ctx context.Context, documentHash string) (string, bool, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT args->>'tokenId' FROM chain_events
		WHERE contract = 'EBLRegistry' AND event_name = 'BillIssued' AND lower(args->>'documentHash') = lower($1)
		ORDER BY block_number DESC LIMIT 1`, documentHash).Scan(&id)
	if err = mapErr(err); err == ErrNotFound {
		return "", false, nil
	}
	return id, err == nil, err
}
