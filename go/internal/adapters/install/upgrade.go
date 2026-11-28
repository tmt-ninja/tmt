package install

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// ReplaceExecutable applies an approved artifact to the running tmt-go.
func ReplaceExecutable(ctx context.Context, source ports.ReleaseSource, artifact ports.Artifact) error {
	path, err := os.Executable()
	if err != nil {
		return err
	}
	return replaceExecutable(ctx, source, artifact, path)
}

func replaceExecutable(ctx context.Context, source ports.ReleaseSource, artifact ports.Artifact, path string) error {
	if artifact.OS != runtime.GOOS || artifact.Arch != runtime.GOARCH {
		return fmt.Errorf("artifact %s/%s does not match the running tmt-go", artifact.OS, artifact.Arch)
	}
	name := filepath.Base(path)
	if !filepath.IsAbs(path) || (name != "tmt-go" && name != "tmt-go-"+runtime.GOOS+"-"+runtime.GOARCH) {
		return fmt.Errorf("refusing to replace unexpected executable %s", path)
	}
	original, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !original.Mode().IsRegular() || original.Mode().Perm()&0111 == 0 {
		return fmt.Errorf("refusing to replace non-regular executable %s", path)
	}
	binary, err := source.Fetch(ctx, artifact)
	if err != nil {
		return err
	}
	if len(binary) == 0 || fmt.Sprintf("%x", sha256.Sum256(binary)) != artifact.SHA256 {
		return fmt.Errorf("Go artifact SHA256 verification failed")
	}

	stage, err := os.CreateTemp(filepath.Dir(path), ".tmt-go-upgrade-")
	if err != nil {
		return err
	}
	defer os.Remove(stage.Name())
	defer stage.Close()
	if _, err := stage.Write(binary); err != nil {
		return err
	}
	if err := stage.Chmod(original.Mode().Perm()); err != nil {
		return err
	}
	if err := stage.Sync(); err != nil {
		return err
	}
	if err := stage.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !os.SameFile(original, current) {
		return fmt.Errorf("executable changed during upgrade: %s", path)
	}
	return os.Rename(stage.Name(), path)
}
