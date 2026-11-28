package storagetest

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestFixtureImageCopiesAreCurrentAndIndependent(t *testing.T) {
	world := t.TempDir()
	first := Seed(t, filepath.Join(world, "first"))
	second := Seed(t, filepath.Join(world, "second"))

	image, err := os.ReadFile(first.Database)
	if err != nil {
		t.Fatal(err)
	}
	copyImage, err := os.ReadFile(second.Database)
	if err != nil || !bytes.Equal(image, copyImage) {
		t.Fatalf("schema image differs: %v", err)
	}
	files, err := os.ReadDir(first.Dir)
	if err != nil || len(files) != 1 || files[0].Name() != filepath.Base(first.Database) {
		t.Fatalf("fixture image left extra files: %v, %v", files, err)
	}
	info, err := os.Stat(first.Database)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("fixture permissions = %v, %v", info, err)
	}

	ctx := t.Context()
	writer, err := storage.Open(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	const id core.IdentityID = "48975455-5cc2-4b2c-8dd6-f534f93704b9"
	if err := writer.Write(ctx, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: id, Name: "Fixture", CanonicalName: "fixture", Lifetime: core.LifetimeSaved}, 10_000)
	}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	other, err := os.ReadFile(second.Database)
	if err != nil || !bytes.Equal(image, other) {
		t.Fatalf("writing one fixture changed the second image: %v", err)
	}
	reader, err := storage.Open(ctx, second)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if version, err := reader.SchemaVersion(ctx); err != nil || version != uint64(storage.SchemaVersion) {
		t.Fatalf("seeded schema = %d, %v", version, err)
	}
	if err := reader.Read(ctx, func(tx ports.StoreTx) error {
		found, err := tx.Identities().FindByID(id)
		if err != nil || found != nil {
			t.Fatalf("identity crossed fixture homes: %+v, %v", found, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSeedRefusesExistingPath(t *testing.T) {
	world := t.TempDir()
	first := Seed(t, filepath.Join(world, "state"))
	before, err := os.ReadFile(first.Database)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := seed(first.Dir); !errors.Is(err, fs.ErrExist) {
		t.Fatalf("seed existing home = %v", err)
	}
	after, err := os.ReadFile(first.Database)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("refused seed changed the existing image: %v", err)
	}
	link := filepath.Join(world, "alias")
	if err := os.Symlink(first.Dir, link); err != nil {
		t.Fatal(err)
	}
	if _, err := seed(link); !errors.Is(err, fs.ErrExist) {
		t.Fatalf("seed symlink home = %v", err)
	}
}

func TestSeedRefusesParentOutsideTemporaryScope(t *testing.T) {
	outside := t.TempDir()
	temporary := t.TempDir()
	t.Setenv("TMPDIR", temporary)
	alias := filepath.Join(temporary, "outside")
	if err := os.Symlink(outside, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := seed(filepath.Join(alias, "state")); err == nil {
		t.Fatal("seed accepted a parent outside the temporary scope")
	}
	if _, err := os.Lstat(filepath.Join(outside, "state")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("refused seed created a directory outside the temporary scope: %v", err)
	}
}
