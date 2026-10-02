package auth

import (
	"errors"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// ErrBadWalletSignature means a wallet signature could not be verified.
var ErrBadWalletSignature = errors.New("auth: invalid wallet signature")

// VerifyWalletSignature recovers the address that signed message with EIP-191 personal_sign (what every wallet's
// signMessage produces). It accepts recovery ids 0/1 and 27/28.
func VerifyWalletSignature(message string, sig []byte) (common.Address, error) {
	if len(sig) != 65 {
		return common.Address{}, fmt.Errorf("%w: signature must be 65 bytes", ErrBadWalletSignature)
	}
	s := make([]byte, 65)
	copy(s, sig)
	if s[64] >= 27 {
		s[64] -= 27
	}
	if s[64] > 1 {
		return common.Address{}, fmt.Errorf("%w: bad recovery id", ErrBadWalletSignature)
	}
	pub, err := crypto.SigToPub(accounts.TextHash([]byte(message)), s)
	if err != nil {
		return common.Address{}, fmt.Errorf("%w: %v", ErrBadWalletSignature, err)
	}
	return crypto.PubkeyToAddress(*pub), nil
}

// SourceAuthorization is the exact message a shipment's exporter signs to authorize an evidence source.
func SourceAuthorization(shipmentID, publicKeyB64 string, sensors []string, issued int64) string {
	return fmt.Sprintf("CargoFlow evidence source\nshipment: %s\npublic key: %s\nsensors: %s\nissued: %d",
		strings.ToLower(shipmentID), publicKeyB64, strings.Join(sensors, ","), issued)
}

// RecoveryAuthorization is the exact message a shipment's exporter signs to request a recovery proof bound to
// submitter.
func RecoveryAuthorization(shipmentID, sensorID, submitter string, issued int64) string {
	return fmt.Sprintf("CargoFlow recovery\nshipment: %s\nsensor: %s\nsubmitter: %s\nissued: %d",
		strings.ToLower(shipmentID), sensorID, strings.ToLower(submitter), issued)
}
