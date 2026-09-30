package merkle_test

import (
	"math/big"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/merkle"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func reading() telemetry.Point {
	return telemetry.Point{
		Timestamp: 1_800_000_000, SensorID: "sensor-2", TemperatureX100: 460, HumidityX100: 6500,
		LatitudeE6: 1_352_083, LongitudeE6: 103_819_836, ShockX100: 12,
	}
}

var salt = big.NewInt(0xC0FFEE)

func TestLeafHashIsDeterministic(t *testing.T) {
	a, err := merkle.LeafHash(reading(), salt)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := merkle.LeafHash(reading(), salt)
	if a.Cmp(b) != 0 {
		t.Fatal("same reading and salt, different leaf")
	}
}

func TestEveryFieldAndTheSaltAreCommitted(t *testing.T) {
	base, _ := merkle.LeafHash(reading(), salt)
	mutations := map[string]func(*telemetry.Point){
		"timestamp":   func(p *telemetry.Point) { p.Timestamp++ },
		"sensor":      func(p *telemetry.Point) { p.SensorID = "sensor-1" },
		"temperature": func(p *telemetry.Point) { p.TemperatureX100++ },
		"humidity":    func(p *telemetry.Point) { p.HumidityX100++ },
		"latitude":    func(p *telemetry.Point) { p.LatitudeE6++ },
		"longitude":   func(p *telemetry.Point) { p.LongitudeE6++ },
		"shock":       func(p *telemetry.Point) { p.ShockX100++ },
	}
	for name, mutate := range mutations {
		p := reading()
		mutate(&p)
		got, err := merkle.LeafHash(p, salt)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got.Cmp(base) == 0 {
			t.Errorf("changing %s did not change the leaf", name)
		}
	}
	other, _ := merkle.LeafHash(reading(), big.NewInt(0xBEEF))
	if other.Cmp(base) == 0 {
		t.Error("the salt is not part of the leaf")
	}
}

func TestNegativeTemperaturesAreRepresentable(t *testing.T) {
	p := reading()
	p.TemperatureX100 = -1800 // frozen cargo at -18 C
	if _, err := merkle.LeafHash(p, salt); err != nil {
		t.Fatal(err)
	}
	if merkle.TempOffsetX100+int64(-8000) <= 0 {
		t.Fatal("offset cannot cover the lowest sensor reading")
	}
}

func TestLeafHashRejectsUnencodableInput(t *testing.T) {
	cases := map[string]func(*telemetry.Point){
		"zero timestamp":    func(p *telemetry.Point) { p.Timestamp = 0 },
		"empty sensor":      func(p *telemetry.Point) { p.SensorID = "" },
		"temp below range":  func(p *telemetry.Point) { p.TemperatureX100 = -10_001 },
		"latitude below":    func(p *telemetry.Point) { p.LatitudeE6 = -90_000_001 },
		"longitude below":   func(p *telemetry.Point) { p.LongitudeE6 = -180_000_001 },
		"negative humidity": func(p *telemetry.Point) { p.HumidityX100 = -1 },
		"negative shock":    func(p *telemetry.Point) { p.ShockX100 = -1 },
	}
	for name, mutate := range cases {
		p := reading()
		mutate(&p)
		if _, err := merkle.LeafHash(p, salt); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if _, err := merkle.LeafHash(reading(), big.NewInt(-1)); err == nil {
		t.Error("negative salt accepted")
	}
	huge := new(big.Int).Lsh(big.NewInt(1), 255)
	if _, err := merkle.LeafHash(reading(), huge); err == nil {
		t.Error("salt outside the field accepted")
	}
}

func TestSensorFieldIsStableAndDistinct(t *testing.T) {
	a, b := merkle.SensorField("sensor-1"), merkle.SensorField("sensor-1")
	if a.Cmp(b) != 0 {
		t.Fatal("unstable")
	}
	if a.Cmp(merkle.SensorField("sensor-2")) == 0 {
		t.Fatal("different sensors collide")
	}
	if a.BitLen() > 248 {
		t.Fatalf("sensor field has %d bits; it must stay below the BN254 modulus", a.BitLen())
	}
}

func TestDeriveSaltIsDeterministicSecretAndPerReading(t *testing.T) {
	secret := []byte("operator master secret")
	var ship [32]byte
	ship[31] = 7
	base := merkle.DeriveSalt(secret, ship, "sensor-1", 1_800_000_000)
	if base.Cmp(merkle.DeriveSalt(secret, ship, "sensor-1", 1_800_000_000)) != 0 {
		t.Fatal("not deterministic")
	}
	var ship2 [32]byte
	ship2[31] = 8
	variants := map[string]*big.Int{
		"secret":    merkle.DeriveSalt([]byte("another secret"), ship, "sensor-1", 1_800_000_000),
		"shipment":  merkle.DeriveSalt(secret, ship2, "sensor-1", 1_800_000_000),
		"sensor":    merkle.DeriveSalt(secret, ship, "sensor-2", 1_800_000_000),
		"timestamp": merkle.DeriveSalt(secret, ship, "sensor-1", 1_800_000_001),
	}
	for name, v := range variants {
		if v.Cmp(base) == 0 {
			t.Errorf("salt does not depend on %s", name)
		}
	}
	if base.BitLen() > 248 || base.Sign() < 0 {
		t.Fatalf("salt must be a field element, got %d bits", base.BitLen())
	}
}

func TestSensorBoundariesCannotBeShiftedAcrossTheSaltInput(t *testing.T) {
	// "a" + ts 11 vs "a1" + ts 1: a naive concatenation would collide
	var ship [32]byte
	s := []byte("k")
	if merkle.DeriveSalt(s, ship, "a", 11).Cmp(merkle.DeriveSalt(s, ship, "a1", 1)) == 0 {
		t.Fatal("ambiguous encoding of sensor id and timestamp")
	}
}
