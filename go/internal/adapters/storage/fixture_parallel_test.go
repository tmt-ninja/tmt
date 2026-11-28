//go:build !race

package storage

import "testing"

// Serial fixtures avoid SQLite contention in the ordinary test suite.
func parallelStorageFixture(*testing.T) {}
