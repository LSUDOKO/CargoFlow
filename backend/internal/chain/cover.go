package chain

import (
	"context"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

// ErrNoCoverPool is returned for cover calls against a deployment without the v2 CoverPool.
var ErrNoCoverPool = errors.New("chain: this deployment has no CoverPool")

// Cover status values, matching ICoverPool.CoverStatus.
const (
	CoverNone     uint8 = 0
	CoverActive   uint8 = 1
	CoverReleased uint8 = 2
	CoverClaimed  uint8 = 3
)

// MaxPremiumBps is the CoverPool's premium cap (20%).
const MaxPremiumBps = 2_000

// CoverStatusName returns the contract's name for a cover status value.
func CoverStatusName(s uint8) string {
	switch s {
	case CoverNone:
		return "NONE"
	case CoverActive:
		return "ACTIVE"
	case CoverReleased:
		return "RELEASED"
	case CoverClaimed:
		return "CLAIMED"
	}
	return "UNKNOWN"
}

// CoverOffer mirrors ICoverPool.Offer: an insurer's escrowed, not yet accepted cover.
type CoverOffer struct {
	Amount     *big.Int
	PremiumBps uint16
}

// Cover mirrors ICoverPool.Cover: the one accepted cover of a facility.
type Cover struct {
	Insurer         common.Address
	Financier       common.Address
	Amount          *big.Int
	Premium         *big.Int
	Status          uint8
	FinancierPayout *big.Int
	InsurerReturn   *big.Int
}

// CoverOf reads a facility's accepted cover (Status CoverNone when there is none).
func (c *Client) CoverOf(ctx context.Context, shipmentID [32]byte) (Cover, error) {
	var out Cover
	err := c.callInto(ctx, &out, "cover", "getCover", shipmentID)
	return out, err
}

// CoverOfferOf reads insurer's open offer on a facility (a zero Amount when there is none).
func (c *Client) CoverOfferOf(ctx context.Context, shipmentID [32]byte, insurer common.Address) (CoverOffer, error) {
	var out CoverOffer
	err := c.callInto(ctx, &out, "cover", "getOffer", shipmentID, insurer)
	return out, err
}

// CoverClaimable is the USDG credited to account by release or claim and not yet withdrawn.
func (c *Client) CoverClaimable(ctx context.Context, account common.Address) (*big.Int, error) {
	out, err := c.call(ctx, "cover", "claimable", account)
	if err != nil {
		return nil, err
	}
	return out[0].(*big.Int), nil
}

// OfferCover escrows amount USDG (approve the pool first) as an insurer's offer while the facility is
// CREATED or FINANCED.
func (c *Client) OfferCover(ctx context.Context, insurer *Signer, shipmentID [32]byte, amount *big.Int, premiumBps uint16) (TxResult, error) {
	return c.Transact(ctx, insurer, "cover", "offerCover", shipmentID, amount, premiumBps)
}

// WithdrawOffer takes back the insurer's unaccepted offer.
func (c *Client) WithdrawOffer(ctx context.Context, insurer *Signer, shipmentID [32]byte) (TxResult, error) {
	return c.Transact(ctx, insurer, "cover", "withdrawOffer", shipmentID)
}

// AcceptCover is the financier buying insurer's offer, paying the premium straight to the insurer.
func (c *Client) AcceptCover(ctx context.Context, financier *Signer, shipmentID [32]byte, insurer common.Address) (TxResult, error) {
	return c.Transact(ctx, financier, "cover", "acceptCover", shipmentID, insurer)
}

// ReleaseCover credits the cover back to the insurer once the facility is SETTLED. Anyone may call it.
func (c *Client) ReleaseCover(ctx context.Context, s *Signer, shipmentID [32]byte) (TxResult, error) {
	return c.Transact(ctx, s, "cover", "release", shipmentID)
}

// ClaimCover pays the financier min(cover, drawn) once the facility is DEFAULTED. Anyone may call it.
func (c *Client) ClaimCover(ctx context.Context, s *Signer, shipmentID [32]byte) (TxResult, error) {
	return c.Transact(ctx, s, "cover", "claim", shipmentID)
}

// WithdrawCoverPayout pulls everything the pool credited to the caller.
func (c *Client) WithdrawCoverPayout(ctx context.Context, s *Signer) (TxResult, error) {
	return c.Transact(ctx, s, "cover", "withdraw")
}
