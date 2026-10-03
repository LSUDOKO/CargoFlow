package auth

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
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

// SourceAuthorization is the exact message a shipment's exporter signs to authorize an Ed25519 evidence source.
func SourceAuthorization(shipmentID, publicKeyB64 string, sensors []string, issued int64) string {
	return DeviceAuthorization(shipmentID, publicKeyB64, "ed25519", sensors, issued)
}

// DeviceAuthorization is the exact message a shipment's exporter signs to authorize an evidence source of any key
// type. For Ed25519 it is SourceAuthorization's message unchanged; other key types add a "key type" line before
// "issued", so a signature for one key type can never register the key as another.
func DeviceAuthorization(shipmentID, publicKeyB64, keyType string, sensors []string, issued int64) string {
	keyLine := ""
	if keyType != "" && keyType != "ed25519" {
		keyLine = "key type: " + keyType + "\n"
	}
	return fmt.Sprintf("CargoFlow evidence source\nshipment: %s\npublic key: %s\nsensors: %s\n%sissued: %d",
		strings.ToLower(shipmentID), publicKeyB64, strings.Join(sensors, ","), keyLine, issued)
}

// NotificationsReadAuthorization is the exact message a wallet signs to mark its notifications read; ids is the
// comma-joined notification ids, or "all".
func NotificationsReadAuthorization(address, ids string, issued int64) string {
	return fmt.Sprintf("CargoFlow notifications read\naddress: %s\nids: %s\nissued: %d", strings.ToLower(address), strings.ToLower(ids), issued)
}

// RecoveryAuthorization is the exact message a shipment's exporter signs to request a recovery proof bound to
// submitter.
func RecoveryAuthorization(shipmentID, sensorID, submitter string, issued int64) string {
	return fmt.Sprintf("CargoFlow recovery\nshipment: %s\nsensor: %s\nsubmitter: %s\nissued: %d",
		strings.ToLower(shipmentID), sensorID, strings.ToLower(submitter), issued)
}

// ContractCaller runs a read-only contract call. *ethclient.Client satisfies it.
type ContractCaller interface {
	CallContract(ctx context.Context, msg ethereum.CallMsg, block *big.Int) ([]byte, error)
}

// eip1271Magic is isValidSignature's selector, which a contract wallet returns for a signature it accepts.
var eip1271Magic = []byte{0x16, 0x26, 0xba, 0x7e}

// VerifyContractSignature asks the contract wallet at addr whether sig is its signature over message, through EIP-1271
// isValidSignature(bytes32,bytes) with the EIP-191 personal_sign hash. An account without code, a revert, or any
// answer other than the magic value means no; err reports only that the call itself could not be made.
func VerifyContractSignature(ctx context.Context, c ContractCaller, addr common.Address, message string, sig []byte) (bool, error) {
	hash := accounts.TextHash([]byte(message))
	// abi.encode(bytes32 hash, bytes sig): the hash, the offset of the bytes, their length, the padded bytes
	data := make([]byte, 0, 4+32*3+len(sig)+31)
	data = append(data, eip1271Magic...)
	data = append(data, hash...)
	data = append(data, common.LeftPadBytes(big.NewInt(64).Bytes(), 32)...)
	data = append(data, common.LeftPadBytes(big.NewInt(int64(len(sig))).Bytes(), 32)...)
	data = append(data, sig...)
	if pad := len(sig) % 32; pad != 0 {
		data = append(data, make([]byte, 32-pad)...)
	}
	out, err := c.CallContract(ctx, ethereum.CallMsg{To: &addr, Data: data}, nil)
	if err != nil {
		return false, err
	}
	return len(out) >= 4 && bytes.Equal(out[:4], eip1271Magic), nil
}

// DocumentAuthorization is the exact message a shipment party signs to attest a document by its hash.
func DocumentAuthorization(shipmentID, kind, sha256Hex string, issued int64) string {
	return fmt.Sprintf("CargoFlow document\nshipment: %s\nkind: %s\nsha256: %s\nissued: %d",
		strings.ToLower(shipmentID), kind, strings.ToLower(sha256Hex), issued)
}

// AlertsAuthorization is the exact message a shipment party signs to subscribe to its alerts. The target is signed
// as given (an empty target for Telegram, which is linked afterwards).
func AlertsAuthorization(shipmentID, channel, target string, issued int64) string {
	return fmt.Sprintf("CargoFlow alerts\nshipment: %s\nchannel: %s\ntarget: %s\nissued: %d",
		strings.ToLower(shipmentID), channel, target, issued)
}

// AlertsOffAuthorization is the exact message a subscriber signs to remove a subscription.
func AlertsOffAuthorization(subscriptionID string, issued int64) string {
	return fmt.Sprintf("CargoFlow alerts off\nsubscription: %s\nissued: %d", subscriptionID, issued)
}

// VesselAuthorization is the exact message a shipment's exporter signs to name the vessel carrying it.
func VesselAuthorization(shipmentID, mmsi string, issued int64) string {
	return fmt.Sprintf("CargoFlow vessel\nshipment: %s\nmmsi: %s\nissued: %d", strings.ToLower(shipmentID), mmsi, issued)
}

// RequestAuthorization is the exact message an exporter signs to post a financing request. amount is USDG base units.
func RequestAuthorization(shipmentID, amount string, maxFeeBps, milestones int, issued int64) string {
	return fmt.Sprintf("CargoFlow financing request\nshipment: %s\namount: %s\nmax fee bps: %d\nmilestones: %d\nissued: %d",
		strings.ToLower(shipmentID), amount, maxFeeBps, milestones, issued)
}

// OfferAuthorization is the exact message a financier signs to offer financing at a fee.
func OfferAuthorization(requestID string, feeBps int, issued int64) string {
	return fmt.Sprintf("CargoFlow offer\nrequest: %s\nfee bps: %d\nissued: %d", strings.ToLower(requestID), feeBps, issued)
}

// AcceptAuthorization is the exact message an exporter signs to accept an offer.
func AcceptAuthorization(requestID, offerID string, issued int64) string {
	return fmt.Sprintf("CargoFlow accept\nrequest: %s\noffer: %s\nissued: %d", strings.ToLower(requestID), strings.ToLower(offerID), issued)
}

// CloseRequestAuthorization is the exact message an exporter signs to withdraw a financing request.
func CloseRequestAuthorization(requestID string, issued int64) string {
	return fmt.Sprintf("CargoFlow close request\nrequest: %s\nissued: %d", strings.ToLower(requestID), issued)
}

// GasAuthorization is the exact message a wallet signs to ask the gas drip for a little native currency.
func GasAuthorization(address string, issued int64) string {
	return fmt.Sprintf("CargoFlow gas\naddress: %s\nissued: %d", strings.ToLower(address), issued)
}
