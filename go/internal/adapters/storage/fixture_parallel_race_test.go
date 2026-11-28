//go:build race

package storage

import "testing"

func parallelStorageFixture(t *testing.T) {
	t.Helper()
	t.Parallel()
}
