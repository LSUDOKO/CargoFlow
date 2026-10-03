package chain

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// EventSink receives decoded events after they are stored. Delivery is at-least-once: a range can be
// delivered again after a crash or a reorganisation, so a sink must be idempotent.
type EventSink func(ctx context.Context, events []store.ChainEvent) error

// Indexer follows the CargoFlow contracts' logs, stores them idempotently keyed on (tx hash, log index),
// hands them to a sink, and only then advances its cursor. A crash at any point re-reads rather than skips.
type Indexer struct {
	C             *Client
	Store         *store.Store
	Name          string // cursor name
	StartBlock    uint64 // first block to index when no cursor exists (the deployment block)
	Confirmations uint64 // 0 or 1: index up to the head; n: stay n-1 blocks behind it
	MaxRange      uint64 // blocks per eth_getLogs call (default 1000)
	ReorgDepth    uint64 // blocks to rewind when the stored hash no longer matches (default 12)
	Poll          time.Duration
	Sink          EventSink
	Log           *slog.Logger

	contracts map[common.Address]contractInfo

	wakeOnce   sync.Once
	wake       chan struct{} // buffered (1): Wake never blocks and wakes coalesce
	wantBlock  atomic.Uint64 // the highest block a wake asked for
	syncedTo   atomic.Uint64 // the last block the cursor reached (0 before the first pass)
	wokenUntil atomic.Int64  // unix nanos until which the loop polls fast to reach wantBlock
}

// wakeFastPoll is how often the loop re-syncs after a wake while the woken block is not yet indexed (the RPC may be a
// little behind the webhook, or the block is not yet CONFIRMATIONS deep); wakeWindow bounds how long it keeps trying.
const (
	wakeFastPoll = 250 * time.Millisecond
	wakeWindow   = 15 * time.Second
)

func (ix *Indexer) wakeCh() chan struct{} {
	ix.wakeOnce.Do(func() { ix.wake = make(chan struct{}, 1) })
	return ix.wake
}

// Wake asks the running loop to sync now instead of waiting for the next poll, up to at least block (0: just sync).
// It never blocks and carries no data into the index: the loop re-reads logs from the RPC as usual, so a forged or
// replayed wake costs one extra pass and changes nothing. It reports whether a wake was queued (false when one was
// already pending, which covers this one too).
func (ix *Indexer) Wake(block uint64) bool {
	for {
		cur := ix.wantBlock.Load()
		if block <= cur || ix.wantBlock.CompareAndSwap(cur, block) {
			break
		}
	}
	ix.wokenUntil.Store(time.Now().Add(wakeWindow).UnixNano())
	select {
	case ix.wakeCh() <- struct{}{}:
		return true
	default:
		return false
	}
}

// Watches reports whether the indexer follows logs emitted by addr.
func (ix *Indexer) Watches(addr common.Address) bool {
	_, ok := ix.C.M.Indexed()[addr]
	return ok
}

// nextDelay is the wait before the next pass: the regular delay, or a short one while a recent wake's block is not
// yet indexed.
func (ix *Indexer) nextDelay(regular time.Duration) time.Duration {
	if want := ix.wantBlock.Load(); want > ix.syncedTo.Load() && time.Now().UnixNano() < ix.wokenUntil.Load() && regular > wakeFastPoll {
		return wakeFastPoll
	}
	return regular
}

type contractInfo struct {
	name string
	abi  abi.ABI
}

func (ix *Indexer) init() {
	if ix.contracts != nil {
		return
	}
	a := ABIs()
	ix.contracts = map[common.Address]contractInfo{}
	for addr, name := range ix.C.M.Indexed() {
		ix.contracts[addr] = contractInfo{name, a[name]}
	}
	if ix.MaxRange == 0 {
		ix.MaxRange = 1000
	}
	if ix.ReorgDepth == 0 {
		ix.ReorgDepth = 12
	}
	if ix.Poll == 0 {
		ix.Poll = 2 * time.Second
	}
	if ix.Log == nil {
		ix.Log = slog.Default()
	}
}

func (ix *Indexer) addresses() []common.Address {
	out := make([]common.Address, 0, len(ix.contracts))
	for a := range ix.contracts {
		out = append(out, a)
	}
	return out
}

// Run syncs until ctx is cancelled, backing off on errors.
func (ix *Indexer) Run(ctx context.Context) error {
	ix.init()
	backoff := ix.Poll
	for {
		n, err := ix.Sync(ctx)
		switch {
		case ctx.Err() != nil:
			return ctx.Err()
		case err != nil:
			ix.Log.Error("indexer sync failed", "err", err, "retry_in", backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
		default:
			if n > 0 {
				ix.Log.Info("indexed chain events", "count", n)
			}
			backoff = ix.Poll
		}
		timer := time.NewTimer(ix.nextDelay(backoff))
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-ix.wakeCh():
			timer.Stop()
		case <-timer.C:
		}
	}
}

// Sync performs one pass and returns how many events it delivered to the sink.
func (ix *Indexer) Sync(ctx context.Context) (int, error) {
	ix.init()

	head, err := ix.C.Eth.BlockNumber(ctx)
	if err != nil {
		return 0, fmt.Errorf("read head: %w", err)
	}
	safe := head
	if ix.Confirmations > 1 {
		if head+1 < ix.Confirmations {
			return 0, nil
		}
		safe = head - (ix.Confirmations - 1)
	}

	cursor, found, err := ix.Store.Cursor(ctx, ix.Name)
	if err != nil {
		return 0, err
	}
	from := ix.StartBlock
	if found {
		reorged, err := ix.reorganised(ctx, cursor)
		if err != nil {
			return 0, err
		}
		if reorged {
			target := uint64(0)
			if cursor.Block > ix.ReorgDepth {
				target = cursor.Block - ix.ReorgDepth
			}
			if ix.StartBlock > 0 && target < ix.StartBlock-1 {
				target = ix.StartBlock - 1
			}
			ix.Log.Warn("chain reorganisation detected; rewinding", "cursor", cursor.Block, "to", target)
			if err := ix.Store.RewindTo(ctx, ix.Name, target); err != nil {
				return 0, err
			}
			cursor.Block = target
		}
		from = cursor.Block + 1
	}

	delivered := 0
	for from <= safe {
		to := from + ix.MaxRange - 1
		if to > safe {
			to = safe
		}
		events, err := ix.readRange(ctx, from, to)
		if err != nil {
			return delivered, err
		}
		if len(events) > 0 {
			if _, err := ix.Store.SaveChainEvents(ctx, events); err != nil {
				return delivered, err
			}
			if ix.Sink != nil {
				if err := ix.Sink(ctx, events); err != nil {
					return delivered, fmt.Errorf("event sink: %w", err) // cursor not advanced: the range is re-read
				}
			}
			delivered += len(events)
		}
		hdr, err := ix.C.Eth.HeaderByNumber(ctx, new(big.Int).SetUint64(to))
		if err != nil {
			return delivered, fmt.Errorf("read header %d: %w", to, err)
		}
		if err := ix.Store.SetLastBlock(ctx, ix.Name, to, hdr.Hash().Hex()); err != nil {
			return delivered, err
		}
		ix.syncedTo.Store(to)
		from = to + 1
	}
	if from > 0 {
		ix.syncedTo.Store(from - 1)
	}
	return delivered, nil
}

// reorganised reports whether the block the cursor points at is no longer on the canonical chain.
func (ix *Indexer) reorganised(ctx context.Context, c store.Cursor) (bool, error) {
	if c.Hash == "" {
		return false, nil // freshly rewound: nothing to compare
	}
	hdr, err := ix.C.Eth.HeaderByNumber(ctx, new(big.Int).SetUint64(c.Block))
	if errors.Is(err, ethereum.NotFound) {
		return true, nil // the chain is now shorter than our cursor
	}
	if err != nil {
		return false, fmt.Errorf("read header %d: %w", c.Block, err)
	}
	return !strings.EqualFold(hdr.Hash().Hex(), c.Hash), nil
}

func (ix *Indexer) readRange(ctx context.Context, from, to uint64) ([]store.ChainEvent, error) {
	logs, err := ix.C.Eth.FilterLogs(ctx, ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(from),
		ToBlock:   new(big.Int).SetUint64(to),
		Addresses: ix.addresses(),
	})
	if err != nil {
		return nil, fmt.Errorf("filter logs %d-%d: %w", from, to, err)
	}
	var out []store.ChainEvent
	times := map[uint64]time.Time{}
	for _, l := range logs {
		if l.Removed {
			continue
		}
		ev, ok, err := ix.decode(l)
		if err != nil {
			return nil, fmt.Errorf("decode log %s#%d: %w", l.TxHash.Hex(), l.Index, err)
		}
		if !ok {
			continue
		}
		// Nodes that return blockTimestamp on logs save a header read; others are asked once per block.
		if l.BlockTimestamp != 0 {
			ev.BlockTime = time.Unix(int64(l.BlockTimestamp), 0).UTC()
		} else if t, seen := times[l.BlockNumber]; seen {
			ev.BlockTime = t
		} else {
			hdr, err := ix.C.Eth.HeaderByNumber(ctx, new(big.Int).SetUint64(l.BlockNumber))
			if err != nil {
				return nil, fmt.Errorf("read header %d: %w", l.BlockNumber, err)
			}
			ev.BlockTime = time.Unix(int64(hdr.Time), 0).UTC()
			times[l.BlockNumber] = ev.BlockTime
		}
		out = append(out, ev)
	}
	return out, nil
}

// decode turns a log into a ChainEvent. Logs from our contracts that are not in the ABI (for example
// inherited OpenZeppelin events) are skipped rather than treated as errors.
func (ix *Indexer) decode(l types.Log) (store.ChainEvent, bool, error) {
	info, ok := ix.contracts[l.Address]
	if !ok || len(l.Topics) == 0 {
		return store.ChainEvent{}, false, nil
	}
	ev, err := info.abi.EventByID(l.Topics[0])
	if err != nil {
		return store.ChainEvent{}, false, nil
	}
	args := map[string]any{}
	var indexed abi.Arguments
	for _, in := range ev.Inputs {
		if in.Indexed {
			indexed = append(indexed, in)
		}
	}
	if err := abi.ParseTopicsIntoMap(args, indexed, l.Topics[1:]); err != nil {
		return store.ChainEvent{}, false, err
	}
	if err := ev.Inputs.NonIndexed().UnpackIntoMap(args, l.Data); err != nil {
		return store.ChainEvent{}, false, err
	}
	for k, v := range args {
		args[k] = jsonValue(v)
	}
	shipment, _ := args["shipmentId"].(string)
	return store.ChainEvent{
		TxHash: l.TxHash.Hex(), LogIndex: int(l.Index), BlockNumber: l.BlockNumber, BlockHash: l.BlockHash.Hex(),
		Contract: info.name, Name: ev.Name, ShipmentID: shipment, Args: args,
	}, true, nil
}

// jsonValue makes a decoded ABI value safe to store as JSON: uint256 becomes a decimal string (it would
// lose precision as a JSON number), addresses and byte arrays become lowercase 0x hex.
func jsonValue(v any) any {
	switch x := v.(type) {
	case *big.Int:
		return x.String()
	case common.Address:
		return "0x" + hex.EncodeToString(x[:])
	case []byte:
		return "0x" + hex.EncodeToString(x)
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Array:
		if rv.Type().Elem().Kind() == reflect.Uint8 { // bytesN
			b := make([]byte, rv.Len())
			reflect.Copy(reflect.ValueOf(b), rv)
			return "0x" + hex.EncodeToString(b)
		}
		fallthrough
	case reflect.Slice:
		out := make([]any, rv.Len())
		for i := range out {
			out[i] = jsonValue(rv.Index(i).Interface())
		}
		return out
	}
	return v
}
