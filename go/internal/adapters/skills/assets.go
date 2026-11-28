package skills

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

//go:embed guides/*/SKILL.md
var guides embed.FS

var names = [...]string{"tmt", "tmt-inbox"}

const assets = "skill-assets"

// Install materializes the current Core guides beneath the tmt-go root.
// The returned directory is an immutable generation for per-launch injection.
//
// NOT PORTED (#6938): provider-global skill installation and owned skill registry.
func Install(root home.Root) (string, error) {
	if !filepath.IsAbs(root.Dir) {
		return "", errors.New("managed skills require a resolved tmt-go home")
	}
	if err := os.MkdirAll(root.Dir, 0700); err != nil {
		return "", err
	}
	state, err := os.OpenRoot(root.Dir)
	if err != nil {
		return "", err
	}
	defer state.Close()
	if err := state.Mkdir(assets, 0700); err != nil && !errors.Is(err, fs.ErrExist) {
		return "", err
	}
	entry, err := state.Lstat(assets)
	if err != nil {
		return "", err
	}
	if !entry.IsDir() {
		return "", fmt.Errorf("managed skill store is not a directory: %s", assets)
	}
	store, err := state.OpenRoot(assets)
	if err != nil {
		return "", err
	}
	defer store.Close()

	digest := sha256.New()
	var content [len(names)][]byte
	for i, name := range names {
		content[i], err = guides.ReadFile("guides/" + name + "/SKILL.md")
		if err != nil {
			return "", err
		}
		digest.Write(binary.BigEndian.AppendUint64(nil, uint64(len(content[i]))))
		digest.Write(content[i])
	}
	generation := fmt.Sprintf("%x", digest.Sum(nil))
	path := filepath.Join(root.Dir, assets, generation)
	if _, err := store.Lstat(generation); err == nil {
		if err := verify(store, generation, content); err != nil {
			return "", err
		}
		return path, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}

	stage := ".stage-" + rand.Text()
	if err := store.Mkdir(stage, 0700); err != nil {
		return "", err
	}
	defer store.RemoveAll(stage)
	for i, name := range names {
		dir := filepath.Join(stage, name)
		if err := store.Mkdir(dir, 0700); err != nil {
			return "", err
		}
		if err := store.WriteFile(filepath.Join(dir, "SKILL.md"), content[i], 0600); err != nil {
			return "", err
		}
	}
	if err := store.Rename(stage, generation); err != nil {
		// A concurrent launch may have published the same generation.
		if verifyErr := verify(store, generation, content); verifyErr != nil {
			return "", errors.Join(err, verifyErr)
		}
	}
	return path, nil
}

func verify(store *os.Root, generation string, content [len(names)][]byte) error {
	invalid := fmt.Errorf("managed skill source has been modified or is invalid: %s", generation)
	info, err := store.Lstat(generation)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return invalid
	}
	entries, err := fs.ReadDir(store.FS(), generation)
	if err != nil {
		return err
	}
	if len(entries) != len(names) {
		return invalid
	}
	for i, name := range names {
		if entries[i].Name() != name || !entries[i].IsDir() {
			return invalid
		}
		dir := generation + "/" + name
		files, err := fs.ReadDir(store.FS(), dir)
		if err != nil {
			return err
		}
		if len(files) != 1 || files[0].Name() != "SKILL.md" || !files[0].Type().IsRegular() {
			return invalid
		}
		if err := verifyEntry(store, dir+"/SKILL.md", content[i]); err != nil {
			return errors.Join(invalid, err)
		}
	}
	return nil
}

func verifyEntry(store *os.Root, path string, expected []byte) error {
	file, err := store.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	actual, err := io.ReadAll(io.LimitReader(file, int64(len(expected)+1)))
	if err != nil {
		return err
	}
	if !bytes.Equal(actual, expected) {
		return fmt.Errorf("unexpected bytes in %s", path)
	}
	return nil
}
