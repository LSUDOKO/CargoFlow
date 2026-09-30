package chain

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

// Signer is one role key. Transactions from a Signer are serialised so its nonce never races, and each
// Signer is used only for the actions its on-chain role allows (the contracts enforce that regardless).
type Signer struct {
	key  *ecdsa.PrivateKey
	addr common.Address
	mu   sync.Mutex
}

// NewSigner wraps a private key.
func NewSigner(key *ecdsa.PrivateKey) *Signer {
	return &Signer{key: key, addr: crypto.PubkeyToAddress(key.PublicKey)}
}

// Address returns the signer's account.
func (s *Signer) Address() common.Address { return s.addr }

// TxResult describes a mined transaction.
type TxResult struct {
	Hash    common.Hash
	Block   uint64
	GasUsed uint64
}

// contract resolves a short name to an address and ABI.
func (c *Client) contract(name string) (common.Address, string, error) {
	switch name {
	case "controller":
		return c.M.Controller, "FinancingController", nil
	case "evidence":
		return c.M.Evidence, "EvidenceRegistry", nil
	case "registry":
		return c.M.Registry, "ShipmentRegistry", nil
	case "policies":
		return c.M.Policies, "PolicyEngine", nil
	case "vault":
		return c.M.Vault, "ReceivableVault", nil
	case "usdg":
		return c.M.USDG, "ERC20", nil
	}
	return common.Address{}, "", fmt.Errorf("chain: unknown contract %q", name)
}

func (c *Client) bound(name string) (*bind.BoundContract, error) {
	addr, abiName, err := c.contract(name)
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(addr, ABIs()[abiName], c.Eth, c.Eth, c.Eth), nil
}

// Transact sends a transaction from s, waits for it to be mined and confirmed, and returns a decoded
// *RevertError if the contract rejects it. Reverts are usually caught at gas estimation, before anything
// is sent, so a rejected action costs no gas.
func (c *Client) Transact(ctx context.Context, s *Signer, contract, method string, args ...any) (TxResult, error) {
	bc, err := c.bound(contract)
	if err != nil {
		return TxResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	opts, err := bind.NewKeyedTransactorWithChainID(s.key, new(big.Int).SetUint64(c.M.ChainID))
	if err != nil {
		return TxResult{}, err
	}
	opts.Context = ctx

	tx, err := bc.Transact(opts, method, args...)
	if err != nil {
		return TxResult{}, fmt.Errorf("%s.%s: %w", contract, method, wrapRevert(err))
	}
	receipt, err := c.waitMined(ctx, tx)
	if err != nil {
		return TxResult{}, fmt.Errorf("%s.%s: waiting for %s: %w", contract, method, tx.Hash().Hex(), err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return TxResult{}, fmt.Errorf("%s.%s: transaction %s failed: %w", contract, method, tx.Hash().Hex(), c.replayRevert(ctx, s, tx, receipt))
	}
	if err := c.waitConfirmations(ctx, receipt.BlockNumber.Uint64()); err != nil {
		return TxResult{}, err
	}
	return TxResult{Hash: tx.Hash(), Block: receipt.BlockNumber.Uint64(), GasUsed: receipt.GasUsed}, nil
}

// receiptPoll is how often we look for a receipt. go-ethereum's bind.WaitMined polls once a second,
// which would add a second of latency to every action on a chain with sub-second blocks.
const receiptPoll = 100 * time.Millisecond

func (c *Client) waitMined(ctx context.Context, tx *types.Transaction) (*types.Receipt, error) {
	ticker := time.NewTicker(receiptPoll)
	defer ticker.Stop()
	for {
		receipt, err := c.Eth.TransactionReceipt(ctx, tx.Hash())
		if err == nil {
			return receipt, nil
		}
		if !errors.Is(err, ethereum.NotFound) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

// replayRevert re-executes a failed transaction at its block to recover the revert reason.
func (c *Client) replayRevert(ctx context.Context, s *Signer, tx *types.Transaction, r *types.Receipt) error {
	msg := ethereum.CallMsg{From: s.addr, To: tx.To(), Data: tx.Data(), Value: tx.Value(), Gas: tx.Gas()}
	_, err := c.Eth.CallContract(ctx, msg, r.BlockNumber)
	if err == nil {
		return errors.New("reverted on chain but the replay succeeded")
	}
	return wrapRevert(err)
}

// waitConfirmations blocks until the chain head is `Confirmations` blocks past block (1 = mined).
func (c *Client) waitConfirmations(ctx context.Context, block uint64) error {
	want := c.Confirmations
	if want <= 1 {
		return nil
	}
	for {
		head, err := c.Eth.BlockNumber(ctx)
		if err != nil {
			return err
		}
		if head+1 >= block+want {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}
