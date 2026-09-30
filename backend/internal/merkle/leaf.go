package merkle

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"

	"github.com/iden3/go-iden3-crypto/poseidon"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Offsets map signed fixed-point readings onto non-negative field elements. The ZK circuit range-checks
// the offset temperature, so its bounds must be offset by the same constant.
const (
	TempOffsetX100 = 10_000      // reading + 10000 is >= 2000 for any valid sensor (-80.00 C and up)
	LatOffsetE6    = 90_000_000  // latitude + 90 degrees
	LonOffsetE6    = 180_000_000 // longitude + 180 degrees
)

// LeafHash commits to one reading and its private salt:
//
//	leaf = Poseidon(timestamp, sensorField, temp+10000, humidity, lat+90e6, lon+180e6, shock, salt)
//
// The salt stops anyone with the public root from brute-forcing low-entropy readings such as
// "4.6 C", and makes leaves unlinkable across epochs. The field order is part of the protocol: the
// circuit hashes leaves in exactly this order.
func LeafHash(p telemetry.Point, salt *big.Int) (*big.Int, error) {
	switch {
	case p.Timestamp <= 0:
		return nil, errors.New("merkle: timestamp must be positive")
	case p.SensorID == "":
		return nil, errors.New("merkle: empty sensor id")
	case int64(p.TemperatureX100)+TempOffsetX100 < 0:
		return nil, fmt.Errorf("merkle: temperature %d below encodable range", p.TemperatureX100)
	case int64(p.LatitudeE6)+LatOffsetE6 < 0:
		return nil, fmt.Errorf("merkle: latitude %d below encodable range", p.LatitudeE6)
	case int64(p.LongitudeE6)+LonOffsetE6 < 0:
		return nil, fmt.Errorf("merkle: longitude %d below encodable range", p.LongitudeE6)
	case p.HumidityX100 < 0 || p.ShockX100 < 0:
		return nil, errors.New("merkle: humidity and shock must be non-negative")
	}
	if err := checkField(salt); err != nil {
		return nil, fmt.Errorf("merkle: salt: %w", err)
	}
	return poseidon.Hash([]*big.Int{
		big.NewInt(p.Timestamp),
		SensorField(p.SensorID),
		big.NewInt(int64(p.TemperatureX100) + TempOffsetX100),
		big.NewInt(int64(p.HumidityX100)),
		big.NewInt(int64(p.LatitudeE6) + LatOffsetE6),
		big.NewInt(int64(p.LongitudeE6) + LonOffsetE6),
		big.NewInt(int64(p.ShockX100)),
		salt,
	})
}

// SensorField maps a sensor id to a 248-bit field element (SHA-256 truncated to 31 bytes), which is
// always below the BN254 modulus.
func SensorField(id string) *big.Int {
	sum := sha256.Sum256([]byte(id))
	return new(big.Int).SetBytes(sum[:31])
}

// DeriveSalt produces the private per-reading salt from an operator secret, so salts never need to be
// stored yet can be reproduced for proving. The encoding is length-prefixed so (sensor, timestamp)
// pairs cannot collide by shifting boundaries.
func DeriveSalt(secret []byte, shipmentID [32]byte, sensorID string, timestamp int64) *big.Int {
	mac := hmac.New(sha256.New, secret)
	mac.Write(shipmentID[:])
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(sensorID)))
	mac.Write(n[:])
	mac.Write([]byte(sensorID))
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], uint64(timestamp))
	mac.Write(ts[:])
	return new(big.Int).SetBytes(mac.Sum(nil)[:31])
}
