// Package archtest enforces the layer and dependency rules of the Go port,
// the counterpart of rust/crates/tmt-cli/tests/architecture.rs.
// Owner: tmt-go-lead. Change a rule only with the lead.
package archtest

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const module = "github.com/tmt-ninja/tmt/go"

type file struct {
	pkg     string // module-relative package dir, e.g. internal/core
	path    string
	test    bool
	imports []string
}

func moduleRoot(t *testing.T) string {
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found")
		}
		dir = parent
	}
}

func load(t *testing.T) []file {
	root := moduleRoot(t)
	var files []file
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "testdata" || strings.HasPrefix(d.Name(), ".")) && path != root {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, filepath.Dir(path))
		entry := file{pkg: filepath.ToSlash(rel), path: path, test: strings.HasSuffix(path, "_test.go")}
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			entry.imports = append(entry.imports, p)
		}
		files = append(files, entry)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func under(pkg, prefix string) bool { return pkg == prefix || strings.HasPrefix(pkg, prefix+"/") }

func internalOf(imp string) (string, bool) {
	if imp == module {
		return "", true
	}
	if strings.HasPrefix(imp, module+"/") {
		return strings.TrimPrefix(imp, module+"/"), true
	}
	return "", false
}

func stdlib(imp string) bool {
	first := strings.SplitN(imp, "/", 2)[0]
	return !strings.Contains(first, ".")
}

// coreAllowedModule admits golang.org/x/text for NFKC and contextual casing,
// the Go counterpart of the ICU crates tmt-core uses (pure tables, no I/O).
func coreAllowedModule(imp string) bool { return strings.HasPrefix(imp, "golang.org/x/text/") }

// coreForbidden are effects the pure domain may not reach.
var coreForbidden = []string{"os", "os/exec", "os/signal", "database/sql", "net", "syscall", "unsafe", "io/fs", "path/filepath"}

func TestLayerRules(t *testing.T) {
	for _, f := range load(t) {
		for _, imp := range f.imports {
			target, internal := internalOf(imp)
			fail := func(rule string) { t.Errorf("%s imports %s: %s", f.path, imp, rule) }

			// Unsafe and raw system calls live only in internal/sys.
			if imp == "unsafe" || imp == "syscall" || strings.HasPrefix(imp, "golang.org/x/sys") {
				if !under(f.pkg, "internal/sys") && !(f.test && under(f.pkg, "test")) {
					fail("only internal/sys may use unsafe, syscall or x/sys")
				}
			}
			if internal && under(target, "internal/sys") && !under(f.pkg, "internal/adapters") && !under(f.pkg, "internal/sys") {
				fail("only adapters import internal/sys")
			}
			// Test support never reaches production code.
			if internal && under(target, "test") && !f.test && !under(f.pkg, "test") {
				fail("production code may not import go/test")
			}

			switch {
			case under(f.pkg, "internal/jobcalendar"), under(f.pkg, "internal/hostgrammar"):
				if internal && !under(target, f.pkg) && !(f.test && under(target, "test")) {
					fail("pure leaves import no other TMT package")
				}
				if !internal && !stdlib(imp) {
					fail("pure leaves import only the standard library")
				}
			case under(f.pkg, "internal/core"):
				if internal && !under(target, "internal/core") && !under(target, "internal/hostgrammar") {
					fail("core imports only core and hostgrammar")
				}
				if !internal && !stdlib(imp) && !coreAllowedModule(imp) {
					fail("core imports only the standard library and golang.org/x/text")
				}
				if !f.test {
					for _, bad := range coreForbidden {
						if imp == bad || strings.HasPrefix(imp, bad+"/") {
							fail("core performs no I/O")
						}
					}
				}
			case under(f.pkg, "internal/ports"):
				if internal && !under(target, "internal/core") {
					fail("ports imports only core")
				}
				if !internal && !stdlib(imp) {
					fail("ports imports only the standard library")
				}
			case under(f.pkg, "internal/clistyle"), under(f.pkg, "internal/output"), under(f.pkg, "internal/invoke"), under(f.pkg, "internal/home"):
				if internal && !under(target, "internal/output") && !under(target, f.pkg) && !(f.test && under(target, "test")) {
					fail("leaf packages import no other TMT package except output")
				}
			case under(f.pkg, "internal/adapters"):
				if internal && (under(target, "internal/cli") || target == "cmd/tmt-go") {
					fail("adapters never import the application layer")
				}
			case under(f.pkg, "cmd/tmt-go"):
				if internal && target != "internal/cli" {
					fail("the entry point imports only internal/cli")
				}
			}
		}
	}
}

// Dependencies outside the standard library need the lead's OK; this list is the record.
var allowedModules = []string{module, "modernc.org/", "golang.org/x/sys", "golang.org/x/term", "golang.org/x/text", "github.com/rivo/uniseg"}

func TestApprovedDependencies(t *testing.T) {
	for _, f := range load(t) {
		for _, imp := range f.imports {
			if stdlib(imp) {
				continue
			}
			ok := false
			for _, allowed := range allowedModules {
				if strings.HasPrefix(imp, allowed) {
					ok = true
				}
			}
			if !ok {
				t.Errorf("%s imports unapproved module %s", f.path, imp)
			}
		}
	}
}
