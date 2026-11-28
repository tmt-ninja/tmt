//go:build darwin || linux

package channel

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestClaudeFixtureRequiresHandshakeAndDeliversOnlyToStdio(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	in := fixtureEnrollment(t)
	runner := testRunner(func(_ context.Context, _ ports.ProcessSpec) (ports.Bounded, error) {
		return ports.Bounded{Stdout: []byte("Sat Jan  1 00:00:00 2000 S\n")}, nil
	})
	toServer, fromClient, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer toServer.Close()
	defer fromClient.Close()
	toClient, fromServer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer toClient.Close()
	defer fromServer.Close()
	deadline, _ := ctx.Deadline()
	if err := toClient.SetReadDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	send := ClaudeDelivery{Root: in.Root, Binding: in.Binding, Identity: in.Identity, Probe: in.Probe, Content: "line one\nline \"two\" 中"}
	if got := SendClaude(ctx, runner, send); got.Outcome != SendUnsupported {
		t.Fatalf("never enrolled: %+v", got)
	}
	lease, err := EnrollClaude(ctx, runner, in)
	if err != nil {
		t.Fatal(err)
	}
	child := core.ProcessIncarnation{PID: uint64(os.Getppid()), StartIdentity: testStart}
	if err := lease.ForegroundStarted(ctx, child); err != nil {
		t.Fatal(err)
	}
	send.Binding.Session = core.BindingSessionState{RuntimeState: "running", Runtime: &child, LaunchOwner: &in.LaunchOwner}
	req := ClaudeServeRequest{Root: in.Root, BindingID: testBinding, Generation: lease.key.Generation, Build: "fixture"}
	done := make(chan error, 1)
	stopped := false
	go func() { done <- ServeClaude(ctx, req, runner, toServer, fromServer) }()
	defer func() {
		cancel()
		_ = fromClient.Close()
		if stopped {
			return
		}
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("channel server did not stop")
		}
	}()

	writeInput := func(line string) {
		t.Helper()
		if _, err := io.WriteString(fromClient, line+"\n"); err != nil {
			t.Fatal(err)
		}
	}
	reader := bufio.NewReader(toClient)
	readOutput := func() map[string]json.RawMessage {
		t.Helper()
		line, err := reader.ReadBytes('\n')
		if err != nil {
			t.Fatal(err)
		}
		var value map[string]json.RawMessage
		if err := json.Unmarshal(line, &value); err != nil {
			t.Fatalf("bad MCP response: %q", line)
		}
		return value
	}
	// An orphan initialized notification grants no readiness; the valid
	// initialize response also serves as proof that the listener has bound.
	writeInput(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	writeInput(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	hello := readOutput()
	var init struct {
		Version      string `json:"protocolVersion"`
		Capabilities map[string]json.RawMessage
	}
	if json.Unmarshal(hello["result"], &init) != nil || init.Version != "2025-06-18" ||
		string(init.Capabilities["experimental"]) != `{"claude/channel":{}}` || init.Capabilities["tools"] != nil {
		t.Fatalf("unexpected initialize result: %s", hello["result"])
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", socketPath(req.Root, req.BindingID))
	if err != nil {
		t.Fatal(err)
	}
	if result := exchangeClaude(ctx, conn, req.Generation, "before handshake"); result != SendDenied {
		t.Fatalf("premature ingress = %v", result)
	}
	conn.Close()
	writeInput(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if result := SendClaude(ctx, runner, send); result.Outcome != SendUnacknowledged || result.Fault != "" {
		t.Fatalf("verified send = %+v", result)
	}
	notification := readOutput()
	var params struct{ Content string }
	if string(notification["method"]) != `"notifications/claude/channel"` || notification["id"] != nil ||
		json.Unmarshal(notification["params"], &params) != nil || params.Content != send.Content {
		t.Fatalf("unexpected notification: %+v", notification)
	}
	writeInput(`{"jsonrpc":"2.0","id":"x","method":"tools/list"}`)
	if failure := readOutput(); string(failure["id"]) != `"x"` || string(failure["error"]) != `{"code":-32601,"message":"Method not found"}` {
		t.Fatalf("tools response = %+v", failure)
	}

	if err := fromClient.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		stopped = true
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	dir, err := openChannelDir(in.Root, false)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.close()
	if _, err := dir.root.Lstat(testBinding + ".sock"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("server left socket entry: %v", err)
	}
	if record, err := dir.readClaude(testBinding); err != nil || record == nil ||
		record.Claude == nil || *record.Claude != storedProcess(child) {
		t.Fatalf("server removed or replaced enrollment: %+v, %v", record, err)
	}
	if result := SendClaude(ctx, runner, send); result != denied(ChannelUnreachable) {
		t.Fatalf("ended listener permitted fallback: %+v", result)
	}
}

func TestClaudeExchangeRequiresOneUnambiguousReceipt(t *testing.T) {
	for _, tc := range []struct {
		reply   string
		outcome SendOutcome
	}{
		{`{"written":true}` + "\n", SendUnacknowledged},
		{`{"refused":"generation"}` + "\n", SendDenied},
		{`{"written":true,"refused":"generation"}` + "\n", SendUncertain},
		{`{"written":true,"written":false}` + "\n", SendUncertain},
		{`{"written":true}`, SendUncertain},
		{"", SendUncertain},
	} {
		t.Run(tc.reply, func(t *testing.T) {
			a, b := net.Pipe()
			defer a.Close()
			defer b.Close()
			done := make(chan error, 1)
			go func() {
				defer b.Close()
				if _, err := readSocketFrame(b, 4096); err != nil {
					done <- err
					return
				}
				_, err := io.WriteString(b, tc.reply)
				done <- err
			}()
			got := exchangeClaude(t.Context(), a, "generation", "content")
			if got != tc.outcome {
				t.Errorf("exchange = %d, want %d", got, tc.outcome)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestClaudeExchangeUsesOneAbsoluteDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	deadline, _ := ctx.Deadline()
	_ = b.SetDeadline(deadline)
	done := make(chan error, 1)
	go func() {
		if _, err := readSocketFrame(b, 4096); err != nil {
			done <- err
			return
		}
		_, err := io.WriteString(b, "{")
		done <- err
		// Keep the connection open with a partial reply until the deadline.
	}()
	if got := exchangeClaude(ctx, a, "generation", "content"); got != SendUncertain {
		t.Fatalf("partial reply = %v", got)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if time.Now().Before(deadline) {
		t.Fatal("partial reply finished before the absolute deadline")
	}
}
