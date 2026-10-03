package geo

import (
	"encoding/hex"
	"math/big"
)

// PlaceDistanceM is contracts/src/libraries/GeoDistance.sol's distanceM, bit for bit: an equirectangular
// projection at the mid latitude on a sphere of radius 6,371,008.8 m with a 1-degree cosine table and linear
// interpolation, in integer micrometres, floored to whole metres. The controller decides milestone places with
// exactly this value (and exposes it through placeCheck); this port lets the backend check a place before it
// pays for a transaction that would revert.
func PlaceDistanceM(aLatE6, aLonE6, bLatE6, bLonE6 int32) uint64 {
	dLat := absDiff(aLatE6, bLatE6)
	dLon := absDiff(aLonE6, bLonE6)
	if dLon > 180_000_000 {
		dLon = 360_000_000 - dLon
	}
	mid := abs64(int64(aLatE6)+int64(bLatE6)) / 2

	um := big.NewInt(umPerDeg)
	dy := new(big.Int).Mul(big.NewInt(dLat), um)
	dy.Quo(dy, big.NewInt(e6))
	dx := new(big.Int).Mul(big.NewInt(dLon), um)
	dx.Mul(dx, new(big.Int).SetUint64(cosE9(uint64(mid))))
	dx.Quo(dx, big.NewInt(e6*cosScale))
	sum := new(big.Int).Add(new(big.Int).Mul(dx, dx), new(big.Int).Mul(dy, dy))
	return new(big.Int).Sqrt(sum).Uint64() / e6
}

const (
	umPerDeg = 111_195_080_234 // R * pi / 180 in micrometres per degree, R = 6,371,008.8 m
	cosScale = 1_000_000_000
)

// placeCos is round(cos(d deg) * 1e9) for d = 0..90, the contract's COS_TABLE.
var placeCos = func() [91]uint64 {
	raw, err := hex.DecodeString("3b9aca003b98770f3b917e6b3b85e09f3b759e923b60b98a3b4733273b290d683b064aa53adeed953ab2f9493a82712f3a4d59113a13b51139d589ae3992dbc2394bb08039000d7438aff884385b77f03802924d37a54e8a3743b3ef36ddca15367398f2360528cb3592823e351bae3c34a0b6093421a33b339e7fbc331755c5328c2fe031fd18e8316a1c0530d344ac30389ea22f9a35f62ef817022e524e692da8e91b2cfbf44c2c4b7d792b9792662ae041182a2597dd2967a54228a6781827e21f6e271aaa952650291a2582aac724b23fa323def7ef2308e424223014f421549b472076883b1f95ed201eb2db7b1dcd65001ce59b941bfb914b1b0f58641a21034b1930a496183e4f03174a157816540b01155c42ce1462d02f1367c69a126b39a2116d3cf9106de46c0f6d43e50e6b6f680d687b0e0c647b0b0b5f83a30a59a93209530021084b9ced0743941f063afa4f0531e41f0428663a031e955402148629010a4d7600000000")
	if err != nil || len(raw) != 91*4 {
		panic("geo: bad cosine table")
	}
	var t [91]uint64
	for i := range t {
		t[i] = uint64(raw[4*i])<<24 | uint64(raw[4*i+1])<<16 | uint64(raw[4*i+2])<<8 | uint64(raw[4*i+3])
	}
	return t
}()

func cosE9(absLatE6 uint64) uint64 {
	if absLatE6 >= 90_000_000 {
		return 0
	}
	i := absLatE6 / e6
	lo, hi := placeCos[i], placeCos[i+1]
	return lo - (lo-hi)*(absLatE6%e6)/e6
}

func absDiff(a, b int32) int64 { return abs64(int64(a) - int64(b)) }
