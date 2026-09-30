//go:build !linux

package chaintest

import "os/exec"

func setPdeathsig(cmd *exec.Cmd) {}
