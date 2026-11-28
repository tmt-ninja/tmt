// Command tmt-go is the Go port of the native tmt executable (experiment #6938).
package main

import (
	"os"

	"github.com/tmt-ninja/tmt/go/internal/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:], os.Stdout, os.Stderr))
}
