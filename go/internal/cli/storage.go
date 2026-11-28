package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type storageReport struct{ footprint storage.Footprint }

func (r storageReport) HumanStream() output.Stream { return output.Stdout }
func (r storageReport) ExitStatus() int            { return 0 }

func (r storageReport) JSON() any {
	f := r.footprint
	type pathDocument struct {
		Path    string `json:"path"`
		Present bool   `json:"present"`
	}
	var database any = pathDocument{Path: f.DatabasePath}
	var notes any = pathDocument{Path: f.NotesPath}
	var colab any = pathDocument{Path: f.ColabPath}
	var pending *bool
	if f.Database == nil {
		absent := false
		pending = &absent
	} else {
		db := f.Database
		document := map[string]any{
			"path": f.DatabasePath, "present": true, "bytes": db.Bytes, "walBytes": db.WALBytes,
			"pageSize": nil, "pageCount": nil, "freePages": nil, "freeBytes": nil, "autoVacuum": nil, "error": db.PageError,
		}
		if pages := db.Pages; pages != nil {
			document["pageSize"], document["pageCount"] = pages.PageSize, pages.PageCount
			document["freePages"], document["freeBytes"] = pages.FreePages, pages.FreeBytes()
			document["autoVacuum"] = pages.AutoVacuum
			needsCompaction := pages.AutoVacuum != storage.AutoVacuumIncremental
			pending = &needsCompaction
		}
		database = document
	}
	if n := f.Notes; n != nil {
		notes = map[string]any{
			"path": f.NotesPath, "present": true, "bytes": n.Bytes, "files": n.Files, "complete": n.Complete,
		}
	}
	if c := f.Colab; c != nil {
		backups := make([]map[string]any, 0, len(c.Backups))
		for _, backup := range c.Backups {
			backups = append(backups, map[string]any{"path": backup.Path, "bytes": backup.Bytes})
		}
		colab = map[string]any{
			"path": f.ColabPath, "present": true, "bytes": c.Bytes, "walBytes": c.WALBytes, "backups": backups,
		}
	}
	return map[string]any{
		"dataRoot": f.DataRoot, "database": database, "notes": notes, "colab": colab,
		"compaction": map[string]any{"pending": pending, "command": nil},
	}
}

func (r storageReport) Human(w io.Writer) error {
	f := r.footprint
	term := outputTerminal(w)
	userHome, _ := os.UserHomeDir()
	shown := func(path string) string { return clistyle.HomePath(path, userHome) }
	if err := clistyle.WriteDetail(w, term, "Local storage", []clistyle.DetailField{{Label: "data root", Value: shown(f.DataRoot)}}); err != nil {
		return err
	}
	if err := storageSection(w, term, "Core database", shown(f.DatabasePath), r.databaseFields()); err != nil {
		return err
	}

	var notes []clistyle.DetailField
	if n := f.Notes; n != nil {
		prefix := ""
		if !n.Complete {
			prefix = "at least "
		}
		notes = []clistyle.DetailField{{Label: "size", Value: fmt.Sprintf("%s%s in %d files", prefix, clistyle.FormatBytes(n.Bytes), n.Files)}}
	}
	if err := storageSection(w, term, "Notes", shown(f.NotesPath), notes); err != nil {
		return err
	}

	var colab []clistyle.DetailField
	if c := f.Colab; c != nil {
		backups := make([]string, 0, len(c.Backups))
		for _, backup := range c.Backups {
			backups = append(backups, filepath.Base(backup.Path)+" "+clistyle.FormatBytes(backup.Bytes))
		}
		display := "none"
		if len(backups) > 0 {
			display = strings.Join(backups, " · ")
		}
		colab = []clistyle.DetailField{
			{Label: "size", Value: storageSize(c.Bytes, c.WALBytes)},
			{Label: "backups", Value: display},
		}
	}
	return storageSection(w, term, "Colab", shown(f.ColabPath), colab)
}

func (r storageReport) databaseFields() []clistyle.DetailField {
	db := r.footprint.Database
	if db == nil {
		return nil
	}
	fields := []clistyle.DetailField{{Label: "size", Value: storageSize(db.Bytes, db.WALBytes)}}
	if pages := db.Pages; pages != nil {
		compaction := "pending"
		if pages.AutoVacuum == storage.AutoVacuumIncremental {
			compaction = "done"
		}
		return append(fields,
			clistyle.DetailField{Label: "free", Value: fmt.Sprintf("%s in %d pages", clistyle.FormatBytes(pages.FreeBytes()), pages.FreePages)},
			clistyle.DetailField{Label: "auto-vacuum", Value: string(pages.AutoVacuum)},
			clistyle.DetailField{Label: "compaction", Value: compaction},
		)
	}
	if db.PageError != nil {
		fields = append(fields, clistyle.DetailField{Label: "pages", Value: "unreadable: " + *db.PageError})
	}
	return fields
}

func storageSection(w io.Writer, term clistyle.Terminal, title, path string, fields []clistyle.DetailField) error {
	if len(fields) == 0 {
		fields = []clistyle.DetailField{{Label: "state", Value: "absent"}}
	}
	if _, err := fmt.Fprintln(w); err != nil {
		return err
	}
	return clistyle.WriteDetail(w, term, title, append([]clistyle.DetailField{{Label: "path", Value: path}}, fields...))
}

func storageSize(bytes, walBytes uint64) string {
	size := clistyle.FormatBytes(bytes)
	if walBytes == 0 {
		return size
	}
	return size + " and a " + clistyle.FormatBytes(walBytes) + " log"
}

// NOT PORTED (CLI-46): Native maintenance guidance after retained-cleanup approval.
func runStorage(ctx context.Context, root home.Root) output.Report {
	f, err := storage.InspectFootprint(ctx, root)
	if err != nil {
		return bindingFailure("STORAGE_REPORT_FAILED", fmt.Sprintf("Could not read the local stores: %v.", err), 1)
	}
	return storageReport{footprint: f}
}
