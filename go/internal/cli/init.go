package cli

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/adapters/config"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type initReport struct {
	Created string `json:"created"`
}

func (r initReport) JSON() any                  { return r }
func (r initReport) HumanStream() output.Stream { return output.Stdout }
func (r initReport) ExitStatus() int            { return 0 }
func (r initReport) Human(w io.Writer) error    { return success(w, "Created "+r.Created) }

func initializeWorkspace(root home.Root) output.Report {
	files, err := configFiles(root)
	if err != nil {
		return configFailure(err)
	}
	path := files.Path(config.Local)
	if err := createWorkspaceConfig(path); errors.Is(err, os.ErrExist) {
		return bindingFailure("ERROR", fmt.Sprintf("%s already exists. Remove it first if you want to reinitialize.", path), 1)
	} else if err != nil {
		return bindingFailure("ERROR", fmt.Sprintf("Could not initialize %s: %v", path, err), 1)
	}
	return initReport{Created: path}
}

func createWorkspaceConfig(path string) error {
	dir, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()

	// Publish only the fully written file. Link fails if another init or
	// editor already owns the destination, even if it is a dangling symlink.
	stage := "." + flavor.Binary + "-init-" + rand.Text()
	file, err := dir.OpenFile(stage, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer dir.Remove(stage)
	_, err = io.WriteString(file, "{}\n")
	if err == nil {
		err = file.Sync()
	}
	if err := errors.Join(err, file.Close()); err != nil {
		return err
	}
	return dir.Link(stage, filepath.Base(path))
}
