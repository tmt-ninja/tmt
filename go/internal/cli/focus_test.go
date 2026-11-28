//go:build darwin || linux

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/test/storagetest"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

const focusWorkerEnv = "TMT_GO_FOCUS_TEST_WORKER"

type focusCall struct {
	Args   []string
	Tmux   *string
	NoPane bool
}

type focusResult struct {
	Code     int
	Out, Err string
}

type focusWorld struct {
	t                                      *testing.T
	server                                 *tmuxtest.Server
	world, state, tmux, script, executable string
}

func newFocusWorld(t *testing.T) focusWorld {
	t.Helper()
	// tmuxtest verifies the socket is private before every setup command.
	server := tmuxtest.Start(t)
	script, err := exec.LookPath("script")
	if err != nil {
		t.Skip("script is required for a private interactive client")
	}
	tmux, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	world := t.TempDir()
	// The timed work starts with the real add, after schema preparation.
	root := storagetest.Seed(t, filepath.Join(world, "state"))
	return focusWorld{t, server, world, root.Dir, tmux, script, executable}
}

func (w focusWorld) tmuxText(args ...string) string {
	w.t.Helper()
	return strings.TrimSpace(w.server.Run(args...))
}

func (w focusWorld) newSession(name string) string {
	w.t.Helper()
	return w.tmuxText("new-session", "-d", "-s", name, "-P", "-F", "#{pane_id}", "cat")
}

func (w focusWorld) attach(session string) string {
	w.t.Helper()
	before := w.views()
	args := []string{w.tmux, "-S", w.server.Socket, "attach-session", "-t", "=" + session + ":"}
	ctx, cancel := context.WithCancel(w.t.Context())
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.CommandContext(ctx, w.script, append([]string{"-q", "/dev/null"}, args...)...)
	} else {
		for i, arg := range args {
			args[i] = core.CommandWord(arg)
		}
		cmd = exec.CommandContext(ctx, w.script, "-q", "-c", strings.Join(args, " "), "/dev/null")
	}
	cmd.Env = append(tmuxtest.Env(), "TERM=xterm-256color")
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	in, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		w.t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		_ = in.Close()
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() {
		_ = in.Close()
		cancel()
		_ = cmd.Wait()
	})
	var client string
	waitForPrivateFake(w.t, ctx, func() (bool, error) {
		for line := range strings.SplitSeq(w.tmuxText("list-clients", "-F", "#{session_name}|#{client_name}"), "\n") {
			if name, ok := strings.CutPrefix(line, session+"|"); ok {
				if _, existed := before[name]; !existed {
					client = name
					return true, nil
				}
			}
		}
		return false, nil
	})
	return client
}

type focusWorker struct{ dir, pane string }

func (w focusWorld) worker(pane string) focusWorker {
	w.t.Helper()
	dir := w.t.TempDir()
	bin := w.t.TempDir()
	if err := os.Symlink(w.tmux, filepath.Join(bin, "tmux")); err != nil {
		w.t.Fatal(err)
	}
	args := []string{
		"/usr/bin/env", "PATH=" + bin + ":/usr/bin:/bin", "HOME=" + w.world, home.EnvHome + "=" + w.state,
		focusWorkerEnv + "=" + dir, w.executable, "-test.run=^TestFocusWorker$",
	}
	for i, arg := range args {
		args[i] = core.CommandWord(arg)
	}
	w.server.Run("respawn-pane", "-k", "-t", pane, "exec "+strings.Join(args, " "))
	return focusWorker{dir, pane}
}

func (w focusWorld) call(worker focusWorker, req focusCall) focusResult {
	w.t.Helper()
	req.Args = append(req.Args, "--json")
	data, err := json.Marshal(req)
	if err != nil {
		w.t.Fatal(err)
	}
	path := filepath.Join(worker.dir, "request")
	if err := writeFocusFile(path, data); err != nil {
		w.t.Fatal(err)
	}
	// Opening the first SQLite writer in a race-instrumented pane worker
	// takes longer than the ordinary pane read deadline.
	ctx, cancel := context.WithTimeout(w.t.Context(), 30*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	result := filepath.Join(worker.dir, "response")
	for {
		raw, err := os.ReadFile(result)
		if err == nil {
			var res focusResult
			if err := json.Unmarshal(raw, &res); err != nil {
				w.t.Fatal(err)
			}
			if err := os.Remove(result); err != nil {
				w.t.Fatal(err)
			}
			return res
		}
		if !os.IsNotExist(err) {
			w.t.Fatal(err)
		}
		select {
		case <-ctx.Done():
			w.t.Fatalf("focus worker %s did not answer %q: %v", worker.pane, req.Args, ctx.Err())
		case <-tick.C:
		}
	}
}

func writeFocusFile(path string, data []byte) error {
	staging := path + ".tmp"
	if err := os.WriteFile(staging, data, 0600); err != nil {
		return err
	}
	return os.Rename(staging, path)
}

func TestFocusWorker(t *testing.T) {
	dir := os.Getenv(focusWorkerEnv)
	if dir == "" {
		return
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	reqPath := filepath.Join(dir, "request")
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		raw, err := os.ReadFile(reqPath)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		var request focusCall
		if err := json.Unmarshal(raw, &request); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(reqPath); err != nil {
			t.Fatal(err)
		}
		app := systemApplication()
		env := app.caller.lookup
		app.caller.lookup = func(key string) (string, bool) {
			if key == "TMUX_PANE" && request.NoPane {
				return "", false
			}
			if key == "TMUX" && request.Tmux != nil {
				return *request.Tmux, true
			}
			return env(key)
		}
		var stdout, stderr bytes.Buffer
		code := app.run(ctx, request.Args, &stdout, &stderr)
		response, err := json.Marshal(focusResult{code, stdout.String(), stderr.String()})
		if err != nil {
			t.Fatal(err)
		}
		if err := writeFocusFile(filepath.Join(dir, "response"), response); err != nil {
			t.Fatal(err)
		}
	}
}

func focusSuccess(t *testing.T, result focusResult, want string) {
	t.Helper()
	var actual, expected any
	if result.Code != 0 || result.Err != "" || json.Unmarshal([]byte(result.Out), &actual) != nil ||
		json.Unmarshal([]byte(want), &expected) != nil {
		t.Fatalf("focus result = %+v, want %s", result, want)
	}
	a, _ := json.Marshal(actual)
	b, _ := json.Marshal(expected)
	if !bytes.Equal(a, b) {
		t.Fatalf("focus result = %s, want %s", a, b)
	}
}

func focusError(t *testing.T, result focusResult, codes ...string) {
	t.Helper()
	var doc struct{ Error struct{ Code string } }
	if result.Code == 0 || result.Err != "" || json.Unmarshal([]byte(result.Out), &doc) != nil ||
		!slices.Contains(codes, doc.Error.Code) {
		t.Fatalf("focus result = %+v, want error %v", result, codes)
	}
}

func focusJSON(value string) string { return strconv.Quote(value) }

func TestFocusSwapGeometryMatchesNative(t *testing.T) {
	for _, side := range []struct {
		direction string
		split     []string
	}{
		{"left", []string{"-h", "-b"}}, {"right", []string{"-h"}},
		{"up", []string{"-v", "-b"}}, {"down", []string{"-v"}},
	} {
		t.Run(side.direction, func(t *testing.T) {
			w := newFocusWorld(t)
			caller := w.tmuxText("display-message", "-p", "-t", "=t:", "#{pane_id}")
			neighbour := w.tmuxText(append([]string{"split-window", "-d", "-P", "-F", "#{pane_id}", "-t", caller}, append(side.split, "cat")...)...)
			target := w.newSession("swap-target")
			worker := w.worker(caller)
			w.server.Run("select-pane", "-t", caller)
			w.attach("t")
			w.add(worker, target, "swap-worker")
			frame := func(pane string) string {
				return w.tmuxText("display-message", "-p", "-t", pane, "#{window_id}|#{pane_left}|#{pane_top}|#{pane_width}|#{pane_height}")
			}
			all := func() []string {
				panes := strings.Split(w.tmuxText("list-panes", "-a", "-F", "#{pane_id}|#{pane_pid}"), "\n")
				slices.Sort(panes)
				return panes
			}
			views := func() string { return w.tmuxText("list-clients", "-F", "#{client_name}|#{session_name}/#{pane_id}") }
			panes, startViews := all(), views()
			callerFrame, neighbourFrame, targetFrame := frame(caller), frame(neighbour), frame(target)
			swap := focusCall{Args: []string{"focus", "swap-worker", "--into", side.direction}}
			focusSuccess(t, w.call(worker, swap), `{"swapped":{"pane":`+focusJSON(target)+`},"with":{"pane":`+focusJSON(neighbour)+`}}`)
			if frame(target) != neighbourFrame || frame(neighbour) != targetFrame || frame(caller) != callerFrame || !slices.Equal(all(), panes) || views() != startViews {
				t.Fatalf("swap changed geometry, a pane process or the client view")
			}
			focusSuccess(t, w.call(worker, swap), `{"swapped":null,"with":{"pane":`+focusJSON(target)+`},"already":true}`)
			if frame(target) != neighbourFrame || !slices.Equal(all(), panes) || views() != startViews {
				t.Fatal("already-beside changed geometry, a pane process or the client view")
			}
		})
	}
}

func (w focusWorld) views() map[string]string {
	w.t.Helper()
	views := map[string]string{}
	for line := range strings.SplitSeq(w.tmuxText("list-clients", "-F", "#{client_name}|#{session_name}/#{pane_id}"), "\n") {
		if client, pane, ok := strings.Cut(line, "|"); ok {
			views[client] = pane
		}
	}
	return views
}

func (w focusWorld) add(worker focusWorker, pane, name string) {
	w.t.Helper()
	if result := w.call(worker, focusCall{Args: []string{"add", pane, name}}); result.Code != 0 || result.Err != "" {
		w.t.Fatalf("cannot add %s: %+v", name, result)
	}
}

func (w focusWorld) initialPane() string {
	w.t.Helper()
	return w.tmuxText("display-message", "-p", "-t", "=t:", "#{pane_id}")
}

func (w focusWorld) assertView(client, want string) {
	w.t.Helper()
	if got := w.views()[client]; got != want {
		w.t.Fatalf("client %q sees %q, want %q", client, got, want)
	}
}

func TestFocusCrossSessionMatchesNative(t *testing.T) {
	w := newFocusWorld(t)
	caller := w.initialPane()
	member := w.newSession("crew")
	// Keep the capture's dimensions fixed as a real TTY enters and leaves
	// the member's session. The native fixture uses a control-mode client.
	w.server.Run("set-option", "-w", "-t", "crew:", "window-size", "manual")
	w.newSession("other")
	from, to := w.worker(caller), w.worker(member)
	w.add(from, member, "member")
	client, other := w.attach("t"), w.attach("other")
	otherBefore := w.views()[other]
	capture := func() string { return w.server.Run("capture-pane", "-p", "-t", member, "-S", "-20") }
	beforeScreen := capture()
	report := func(target, prior string) string {
		return `{"focused":{"pane":` + focusJSON(target) + `},"from":{"pane":` + focusJSON(prior) + `},"client":` + focusJSON(client) + `}`
	}
	focusSuccess(t, w.call(from, focusCall{Args: []string{"focus", "member"}}), report(member, caller))
	w.assertView(client, "crew/"+member)
	w.assertView(other, otherBefore)
	before := w.views()
	view := `{"client":` + focusJSON(client) + `,"pane":` + focusJSON(member) + `}`
	focusSuccess(t, w.call(to, focusCall{Args: []string{"focus", "--client"}}), view)
	if !maps.Equal(w.views(), before) {
		t.Fatal("focus --client moved an attached client")
	}
	focusSuccess(t, w.call(to, focusCall{Args: []string{"focus", "--client"}, NoPane: true}), view)
	focusError(t, w.call(to, focusCall{Args: []string{"focus", "member", "--client"}}), "USAGE_ERROR")
	if !maps.Equal(w.views(), before) {
		t.Fatal("key-job or invalid focus moved an attached client")
	}
	focusSuccess(t, w.call(to, focusCall{Args: []string{"focus", caller}}), report(caller, member))
	w.assertView(client, "t/"+caller)
	w.assertView(other, otherBefore)
	if afterScreen := capture(); afterScreen != beforeScreen {
		t.Fatalf("focus changed the member pane screen: before %q, after %q", beforeScreen, afterScreen)
	}
}

func TestFocusSwapRefusalsMatchNative(t *testing.T) {
	w := newFocusWorld(t)
	caller := w.initialPane()
	target := w.newSession("swap-refusals")
	worker := w.worker(caller)
	w.attach("t")
	before := w.views()
	panes := func() string { return w.server.Run("list-panes", "-a", "-F", "#{pane_id}|#{window_id}|#{pane_pid}") }
	beforePanes := panes()
	for _, target := range []string{target, "%99999"} {
		focusError(t, w.call(worker, focusCall{Args: []string{"focus", target, "--into", "left"}}), "PANE_NOT_FOUND")
	}
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", caller, "--into", "right"}}), "HOST_UNSUPPORTED")
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", target, "--into", "right"}, NoPane: true}), "HOST_UNSUPPORTED")
	if !maps.Equal(w.views(), before) || panes() != beforePanes {
		t.Fatal("a refused swap changed a client view or pane")
	}
	w.server.Run("split-window", "-h", "-d", "-t", caller, "cat")
	w.server.Run("select-pane", "-t", caller)
	w.server.Run("resize-pane", "-Z", "-t", caller)
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", target, "--into", "right"}}), "PANE_NOT_FOUND")
	if w.tmuxText("display-message", "-p", "-t", caller, "#{window_zoomed_flag}") != "1" || !maps.Equal(w.views(), before) {
		t.Fatal("refused swap changed zoom or a client view")
	}
	w.server.Run("kill-pane", "-t", target)
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", target, "--into", "right"}}), "PANE_NOT_FOUND")
	if !maps.Equal(w.views(), before) {
		t.Fatal("gone target changed a client view")
	}
}

func TestFocusRefusesStaleOrUnattachedAsNative(t *testing.T) {
	w := newFocusWorld(t)
	caller := w.initialPane()
	member := w.newSession("crew")
	worker := w.worker(caller)
	w.add(worker, member, "member")
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "member"}}), "HOST_UNSUPPORTED")
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "--client"}}), "HOST_UNSUPPORTED")
	w.attach("t")
	before := w.views()
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "%9999"}}), "PANE_NOT_FOUND")
	session := strings.TrimPrefix(w.tmuxText("display-message", "-p", "-t", member, "#{session_id}"), "$")
	pid := w.tmuxText("display-message", "-p", "-t", member, "#{pid}")
	crewJob := w.server.Socket + "," + pid + "," + session
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "member"}, Tmux: &crewJob, NoPane: true}), "HOST_UNSUPPORTED")
	w.server.Run("respawn-pane", "-k", "-t", member, "cat")
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "member"}}), "NAME_NOT_FOUND", "RECONCILIATION_FAILED")
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "member", "--into", "left"}}), "NAME_NOT_FOUND", "RECONCILIATION_FAILED")
	if !maps.Equal(w.views(), before) {
		t.Fatal("missing or stale target changed a client view")
	}
	w.attach("t")
	before = w.views()
	focusError(t, w.call(worker, focusCall{Args: []string{"focus", "--client"}, NoPane: true}), "HOST_UNSUPPORTED")
	if !maps.Equal(w.views(), before) {
		t.Fatal("ambiguous key job changed a client view")
	}
}

func TestFocusRefusesForeignServerAsNative(t *testing.T) {
	owner := newFocusWorld(t)
	target := owner.newSession("crew")
	owner.add(owner.worker(owner.initialPane()), target, "member")
	foreign := newFocusWorld(t)
	foreign.world, foreign.state = owner.world, owner.state
	caller := foreign.worker(foreign.initialPane())
	foreign.attach("t")
	before := foreign.views()
	focusError(t, foreign.call(caller, focusCall{Args: []string{"focus", "member"}}), "HOST_UNSUPPORTED")
	focusError(t, foreign.call(caller, focusCall{Args: []string{"focus", "member", "--into", "left"}}), "HOST_UNSUPPORTED")
	if !maps.Equal(foreign.views(), before) {
		t.Fatal("foreign target changed the caller client")
	}
	if _, err := os.Stat(owner.world); err != nil {
		t.Fatalf("owner home changed: %v", err)
	}
}

// Cases from Rust parser/tests/identity.rs.
func TestFocusParserMatchesNativeForms(t *testing.T) {
	for _, target := range []string{"auth-fix", "%2"} {
		parsed, failure := parse([]string{"focus", target, "--json"})
		if failure != nil || !slices.Equal(parsed.path, []string{"focus"}) || !slices.Equal(parsed.operands, []string{target}) || !parsed.json ||
			parsed.has("into") || parsed.has("client") {
			t.Fatalf("focus %q parsed as %+v, failure %+v", target, parsed, failure)
		}
	}
	parsed, failure := parse([]string{"focus", "--client", "--json"})
	if failure != nil || !slices.Equal(parsed.path, []string{"focus"}) || !parsed.has("client") ||
		len(parsed.operands) != 0 || !parsed.json {
		t.Fatalf("focus --client parsed as %+v, failure %+v", parsed, failure)
	}
	for _, direction := range []string{"left", "right", "up", "down"} {
		parsed, failure := parse([]string{"focus", "worker", "--into", direction, "--json"})
		if failure != nil || !slices.Equal(parsed.operands, []string{"worker"}) || parsed.options["into"] != direction || !parsed.json {
			t.Fatalf("focus --into %q parsed as %+v, failure %+v", direction, parsed, failure)
		}
	}
	for _, args := range [][]string{
		{"focus"}, {"focus", "auth-fix", "--client"}, {"focus", "worker", "--into", "diagonal"},
		{"focus", "--client", "--into", "left"}, {"focus", "--into", "left"},
	} {
		if _, failure := parse(args); failure == nil || failure.Code != "USAGE_ERROR" {
			t.Fatalf("%v should fail usage, got %+v", args, failure)
		}
	}
}

func TestFocusUsageMatchesNativeDiagnostics(t *testing.T) {
	for _, test := range []struct {
		args []string
		want string
	}{
		{
			[]string{"%1", "--client", "--json"},
			"error: the argument '[target]' cannot be used with '--client'\n\nUsage: " + flavor.Binary + " focus --json <target>\n",
		},
		{
			[]string{"--client", "%1", "--json"},
			"error: the argument '--client' cannot be used with '[target]'\n\nUsage: " + flavor.Binary + " focus --client --json [target]\n",
		},
		{
			[]string{"--json", "--client", "%1", "--into", "left"},
			"error: the argument '--client' cannot be used with:\n  [target]\n  --into <into>\n\nUsage: " + flavor.Binary + " focus --json --client [target]\n",
		},
		{
			[]string{"%1", "--into", "diagonal", "--json"},
			"error: invalid value 'diagonal' for '--into <into>'\n  [possible values: left, right, up, down]\n\n  tip: a similar value exists: 'down'\n",
		},
	} {
		_, failure := parse(append([]string{"focus"}, test.args...))
		if failure == nil || failure.Message != test.want {
			t.Errorf("focus %v = %v, want %q", test.args, failure, test.want)
		}
	}
}
