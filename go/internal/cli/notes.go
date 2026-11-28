package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type notesPathReport struct {
	IdentityID core.IdentityID `json:"identityId"`
	Path       string          `json:"path"`
	Created    bool            `json:"created"`
}

func (r notesPathReport) JSON() any                  { return r }
func (r notesPathReport) HumanStream() output.Stream { return output.Stdout }
func (r notesPathReport) ExitStatus() int            { return 0 }
func (r notesPathReport) Human(w io.Writer) error {
	_, err := fmt.Fprintln(w, r.Path)
	return err
}

func (app application) runNotes(ctx context.Context, root home.Root, inv invocation) output.Report {
	if len(inv.path) != 2 {
		return talkUsage("A notes subcommand is required.")
	}
	selected, failure := app.caller.selectIdentity(ctx, inv)
	if failure != nil {
		return failure
	}
	unavailable := bindingFailure("NOTES_IO_ERROR", "Could not initialize the saved identity notes file.", 1)
	return withIdentityStore(ctx, root, app.store, unavailable, func(store ports.Store) output.Report {
		app.store = store
		identity, _, failure := app.requestIdentities(ctx, selected, nil)
		if failure != nil {
			return failure
		}
		if identity.Lifetime != core.LifetimeSaved {
			return bindingFailure("NOTES_SAVED_IDENTITY_REQUIRED", "Notes require a saved identity; save this identity or select one with --identity.", 1)
		}
		if !core.IsCanonicalIdentityID(string(identity.ID)) {
			return unavailable
		}
		created, err := initializeNotes(root, identity.ID)
		if err != nil {
			return unavailable
		}
		return notesPathReport{identity.ID, filepath.Join(root.Dir, "notes", string(identity.ID), "notes.md"), created}
	})
}

func initializeNotes(root home.Root, id core.IdentityID) (bool, error) {
	info, err := os.Lstat(root.Dir)
	if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, errors.New("notes data root must be a directory")
	}
	base, err := os.OpenRoot(root.Dir)
	if err != nil {
		return false, err
	}
	defer base.Close()
	if err := sameDirectory(base, info); err != nil {
		return false, err
	}
	notes, err := privateNotesDir(base, "notes")
	if err != nil {
		return false, err
	}
	defer notes.Close()
	member, err := privateNotesDir(notes, string(id))
	if err != nil {
		return false, err
	}
	defer member.Close()

	file, err := member.OpenFile("notes.md", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		info, err := member.Lstat("notes.md")
		if err != nil {
			return false, err
		}
		if !info.Mode().IsRegular() {
			return false, errors.New("notes path must be a regular file")
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return false, err
	}
	if err := file.Sync(); err != nil {
		return false, err
	}
	return true, nil
}

func privateNotesDir(root *os.Root, name string) (*os.Root, error) {
	created := false
	if err := root.Mkdir(name, 0700); err == nil {
		created = true
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("notes path must be a directory")
	}
	dir, err := root.OpenRoot(name)
	if err != nil {
		return nil, err
	}
	if err := sameDirectory(dir, info); err != nil {
		dir.Close()
		return nil, err
	}
	if created {
		if err := dir.Chmod(".", 0700); err != nil {
			dir.Close()
			return nil, err
		}
	}
	return dir, nil
}

func sameDirectory(dir *os.Root, expected os.FileInfo) error {
	found, err := dir.Stat(".")
	if err != nil {
		return err
	}
	if !os.SameFile(found, expected) {
		return errors.New("notes directory changed during initialization")
	}
	return nil
}
