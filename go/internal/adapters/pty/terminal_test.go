//go:build darwin || linux

package pty

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/driverprotocol"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ptyprotocol"
)

type attachFixture struct {
	Root     home.Root
	Identity core.Identity
	Binding  core.Binding
}

func TestAttachAuthenticatesAndDetachesOnTheSameConnection(t *testing.T) {
	script, err := exec.LookPath("script")
	if err != nil {
		t.Skip("script is required for a private interactive terminal")
	}
	root, err := os.MkdirTemp("/tmp", "tmtgo-attach-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	dir := filepath.Join(root, "pty")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "fixture.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, "/bin/sleep", "15")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	pid := os.Getpid()
	starts, err := (runtime.Observer{Process: process.Runner{}}).ObserveStarts(ctx, []int{pid, child.Process.Pid})
	if err != nil || len(starts) != 2 {
		t.Fatalf("fixture incarnation = %+v, %v", starts, err)
	}
	identity := core.Identity{ID: "identity", Name: "Fixture", CanonicalName: "fixture"}
	paneStart := starts[child.Process.Pid].Start
	binding := core.Binding{ID: "binding", IdentityID: identity.ID,
		Server: core.ServerEvidence{Host: "pty", ID: "fixture", Socket: path, PID: uint64(pid), StartTime: starts[pid].Start},
		PaneID: "fixture", PanePID: uint64(child.Process.Pid), PaneIncarnation: &paneStart}
	fixture := attachFixture{Root: home.Root{Dir: root}, Identity: identity, Binding: binding}
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	incorrect := binding
	incorrect.Server.PID++
	if client, err := OpenTerminal(ctx, fixture.Root, identity, incorrect); !errors.Is(err, ErrTerminalUnverified) {
		if client != nil {
			_ = client.Close()
		}
		t.Fatalf("wrong supervisor incarnation accepted: %v", err)
	}
	deadline, _ := ctx.Deadline()
	if err := listener.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	rejected, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	if err := rejected.SetReadDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	var nothing [1]byte
	n, readErr := rejected.Read(nothing[:])
	_ = rejected.Close()
	if n != 0 || !errors.Is(readErr, io.EOF) {
		t.Fatalf("unverified peer received a frame: %d, %v", n, readErr)
	}
	config := filepath.Join(root, "fixture.json")
	if err := os.WriteFile(config, raw, 0600); err != nil {
		t.Fatal(err)
	}

	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	args := []string{executable, "-test.run=^TestAttachFixtureHelper$"}
	var command *exec.Cmd
	if goruntime.GOOS == "darwin" {
		command = exec.CommandContext(ctx, script, append([]string{"-q", "/dev/null"}, args...)...)
	} else {
		for i, arg := range args {
			args[i] = "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
		}
		command = exec.CommandContext(ctx, script, "-q", "-c", strings.Join(args, " "), "/dev/null")
	}
	command.Env = append(os.Environ(), "TMT_TEST_ATTACH_FIXTURE="+config, "TERM=xterm-256color")
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output := &attachFixtureOutput{painted: make(chan struct{})}
	command.Stdout, command.Stderr = output, output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	finished := false
	defer func() {
		if !finished {
			cancel()
			_ = command.Wait()
		}
	}()
	peer, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if err := peer.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	decoder := ptyprotocol.NewDecoder()
	read := func(want ptyprotocol.ClientMessageKind) ptyprotocol.ClientMessage {
		t.Helper()
		for {
			frame, ok, err := decoder.NextClient()
			if err != nil {
				t.Fatal(err)
			}
			if ok {
				if frame.Tag != want {
					t.Fatalf("received frame %+v, want %v", frame, want)
				}
				return frame
			}
			var buf [4096]byte
			n, err := peer.Read(buf[:])
			if n > 0 {
				if err := decoder.Push(buf[:n]); err != nil {
					t.Fatal(err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		}
	}
	send := func(frame ptyprotocol.ServerMessage) {
		t.Helper()
		if err := fullWrite(peer, frame.Encode()); err != nil {
			t.Fatal(err)
		}
	}
	if hello := read(ptyprotocol.ClientHello); hello.Version != ptyprotocol.Version {
		t.Fatalf("hello = %+v", hello)
	}
	size := ptyprotocol.Size{Cols: 80, Rows: 24}
	send(ptyprotocol.ServerMessage{Tag: ptyprotocol.ServerWelcome, Version: ptyprotocol.Version, Size: size})
	if inspect := read(ptyprotocol.ClientControl); inspect.Control.Tag != ptyprotocol.ControlInspect {
		t.Fatalf("inspect = %+v", inspect)
	}
	marker := binding.Marker(identity)
	markerBytes, err := json.Marshal(driverprotocol.Marker{Name: string(marker.Name), CanonicalName: marker.CanonicalName,
		IdentityID: string(marker.IdentityID), BindingID: string(marker.BindingID), ServerID: marker.ServerID, PanePID: marker.PanePID})
	if err != nil {
		t.Fatal(err)
	}
	send(ptyprotocol.ServerMessage{Tag: ptyprotocol.ServerControl, Control: &ptyprotocol.ControlReply{
		Tag: ptyprotocol.ReplyState, SupervisorPID: uint32(pid), PanePID: uint32(child.Process.Pid), Marker: new(string(markerBytes)),
	}})
	resize := read(ptyprotocol.ClientResize)
	read(ptyprotocol.ClientTakeSole)
	read(ptyprotocol.ClientSnapshot)
	send(ptyprotocol.ServerMessage{Tag: ptyprotocol.ServerSnapshotStart})
	send(ptyprotocol.ServerMessage{Tag: ptyprotocol.ServerSnapshotData, Data: []byte("verified-frame")})
	send(ptyprotocol.ServerMessage{Tag: ptyprotocol.ServerSnapshotEnd, Size: resize.Size})
	select {
	case <-output.painted:
	case <-ctx.Done():
		_ = command.Wait()
		finished = true
		t.Fatalf("attach did not paint private snapshot: %q", output.buffer.String())
	}
	if _, err := io.WriteString(input, "keys\x1cnot forwarded"); err != nil {
		t.Fatal(err)
	}
	if got := read(ptyprotocol.ClientInput); string(got.Data) != "keys" {
		t.Fatalf("relayed input = %q", got.Data)
	}
	read(ptyprotocol.ClientDetach)
	err = command.Wait()
	finished = true
	view := output.buffer.String()
	if err != nil || !strings.Contains(view, "verified-frame") || !strings.Contains(view, "attach-detached") {
		t.Fatalf("attach process = %v, output = %q", err, view)
	}
}

type attachFixtureOutput struct {
	buffer  bytes.Buffer
	painted chan struct{}
	seen    bool
}

func (o *attachFixtureOutput) Write(data []byte) (int, error) {
	n, err := o.buffer.Write(data)
	if !o.seen && bytes.Contains(o.buffer.Bytes(), []byte("verified-frame")) {
		o.seen = true
		close(o.painted)
	}
	return n, err
}

func TestAttachFixtureHelper(t *testing.T) {
	config := os.Getenv("TMT_TEST_ATTACH_FIXTURE")
	if config == "" {
		return
	}
	if !strings.HasPrefix(filepath.Base(filepath.Dir(config)), "tmtgo-attach-") || filepath.Base(config) != "fixture.json" {
		t.Fatal("attach fixture requires its private test root")
	}
	raw, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	var fixture attachFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Root.Dir != filepath.Dir(config) {
		t.Fatal("attach fixture root changed")
	}
	client, err := OpenTerminal(t.Context(), fixture.Root, fixture.Identity, fixture.Binding)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	terminalModes := func() [3]string {
		t.Helper()
		command := exec.Command("/bin/stty", "-a")
		command.Stdin = os.Stdin
		text, err := command.Output()
		if err != nil {
			t.Fatal(err)
		}
		var modes [3]string
		for _, word := range strings.Fields(strings.ReplaceAll(string(text), ";", " ")) {
			switch strings.TrimPrefix(word, "-") {
			case "icanon":
				modes[0] = word
			case "echo":
				modes[1] = word
			case "isig":
				modes[2] = word
			}
		}
		if modes[0] == "" || modes[1] == "" || modes[2] == "" {
			t.Fatal("fixture could not observe the terminal mode")
		}
		return modes
	}
	before := terminalModes()
	end, err := client.Attach(t.Context(), os.Stdin, os.Stdout, true)
	if err != nil || end.Kind != AttachDetached || end.ExitStatus() != 0 {
		t.Fatalf("attach = %+v, %v", end, err)
	}
	// Darwin can set the transient PENDIN bit on return to canonical input.
	// Compare the input modes changed by raw attachment.
	if after := terminalModes(); before != after {
		t.Fatalf("terminal modes before = %v, after = %v", before, after)
	}
	_, _ = io.WriteString(os.Stdout, "attach-detached\n")
}

func TestAttachFiltersOnlyAlternateScreenModes(t *testing.T) {
	for _, cut := range []int{0, 1, 2, 3, 9, 12} {
		text := []byte("x\x1b[?1049;25hy\x1b[31mz")
		var modes screenSwitches
		first, firstRemoved := modes.filter(text[:cut])
		next, nextRemoved := modes.filter(text[cut:])
		got := string(append(append(first, next...), modes.held...))
		if got != "x\x1b[?25hy\x1b[31mz" || !(firstRemoved || nextRemoved) {
			t.Fatalf("cut %d: %q, %v, %v", cut, got, firstRemoved, nextRemoved)
		}
	}
	var screen attachScreen
	err := screen.frame(ptyprotocol.ServerMessage{Tag: ptyprotocol.ServerSnapshotData}, io.Discard, nil)
	if !errors.Is(err, errTerminalProtocol) {
		t.Fatalf("unframed snapshot: %v", err)
	}
}
