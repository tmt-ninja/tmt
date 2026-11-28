// Package storagetest seeds isolated Go database fixtures from a closed schema image.
package storagetest

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

// Seed creates an empty, fully migrated home at an absent child of a private
// temporary directory. The caller owns its environment and fixture contents.
func Seed(t testing.TB, dir string) home.Root {
	t.Helper()
	root, err := seed(dir)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func seed(dir string) (home.Root, error) {
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		return home.Root{}, fmt.Errorf("fixture home requires a clean absolute path: %q", dir)
	}
	temp, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		return home.Root{}, err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(dir))
	if err != nil {
		return home.Root{}, err
	}
	within, err := filepath.Rel(temp, parent)
	if err != nil || !filepath.IsLocal(within) {
		return home.Root{}, fmt.Errorf("fixture home is outside the temporary directory: %q", dir)
	}
	root, err := fixtureHome(dir, filepath.Dir(dir))
	if err != nil {
		return home.Root{}, err
	}
	if err := os.Mkdir(root.Dir, 0700); err != nil {
		return home.Root{}, err
	}
	image, err := fixtureImage()
	if err != nil {
		return home.Root{}, err
	}
	file, err := os.OpenFile(root.Database, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return home.Root{}, err
	}
	_, err = file.Write(image)
	if err := errors.Join(err, file.Close()); err != nil {
		return home.Root{}, err
	}
	return root, nil
}

func fixtureHome(dir, privateUserHome string) (home.Root, error) {
	return home.Resolve(func(key string) (string, bool) {
		return dir, key == home.EnvHome
	}, privateUserHome)
}

var fixtureImage = sync.OnceValues(buildFixtureImage)

func buildFixtureImage() (_ []byte, err error) {
	temp, err := os.MkdirTemp("", "tmt-go-cli-storage-")
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, os.RemoveAll(temp)) }()
	root, err := fixtureHome(filepath.Join(temp, "state"), temp)
	if err != nil {
		return nil, err
	}
	store, err := storage.Open(context.Background(), root)
	if err != nil {
		return nil, err
	}
	if err := store.Close(); err != nil {
		return nil, err
	}

	// The template has one owner and Close checkpoints the WAL. Check the
	// result before reading the main file so a partial image cannot escape.
	wal, err := os.Lstat(root.Database + "-wal")
	if err == nil && wal.Size() != 0 {
		return nil, errors.New("storage fixture checkpoint left frames in the WAL")
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	return os.ReadFile(root.Database)
}
