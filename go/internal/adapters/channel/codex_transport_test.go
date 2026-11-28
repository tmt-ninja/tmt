//go:build darwin || linux

package channel

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const testCodexToken = "fixture-capability"
const testThread = "owned-thread"

func TestCodexAcceptanceIsOneDeliveryWrite(t *testing.T) {
	for _, version := range []string{"0.159.2", "0.159.3", "0.160.0"} {
		t.Run(version, func(t *testing.T) {
			got := exerciseCodex(t, version, "accept")
			if got != (codexQueueResult{outcome: codexQueueAccepted, submissionID: "provider-submission"}) {
				t.Fatalf("acceptance = %+v", got)
			}
		})
	}
}

func TestCodexInternalErrorLostReceiptAndWrongCorrelationNeverResend(t *testing.T) {
	for _, reply := range []string{"internal", "lost", "wrong-id", "wrong-input", "wrong-caller", "ambiguous"} {
		t.Run(reply, func(t *testing.T) {
			if got := exerciseCodex(t, "0.160.0", reply); got.outcome != codexQueueUncertain {
				t.Fatalf("outcome = %+v", got)
			}
		})
	}
}

func TestCodexExactArchivedAndDeletedRefusalsNeverResend(t *testing.T) {
	for _, tc := range []struct {
		reply string
		code  int64
	}{{"archived", -32600}, {"deleted", -32603}} {
		t.Run(tc.reply, func(t *testing.T) {
			if got := exerciseCodex(t, "0.160.0", tc.reply); got != (codexQueueResult{outcome: codexQueueRefused, refusalCode: tc.code}) {
				t.Fatalf("refusal = %+v", got)
			}
		})
	}
}

func exerciseCodex(t *testing.T, version, reply string) codexQueueResult {
	t.Helper()
	endpoint, connections, done := codexFixture(t, version, func(ctx context.Context, socket *websocket.Conn, queue testQueue) error {
		if reply == "lost" {
			return nil
		}
		response := map[string]any{"id": queue.ID}
		switch reply {
		case "internal":
			response["error"] = map[string]any{"code": -32603, "message": "failed to serialize queued submission"}
		case "archived":
			response["error"] = map[string]any{"code": -32600, "message": "session owned-thread is archived. Run `codex unarchive owned-thread` to unarchive it first."}
		case "deleted":
			response["error"] = map[string]any{"code": -32603, "message": "failed to read thread: invalid thread-store request: no rollout found for thread id owned-thread"}
		case "wrong-id":
			response["id"] = "different-request"
			response["error"] = map[string]any{"code": -32603, "message": "internal error"}
		default:
			caller, input := queue.Params.Caller, queue.Params.Input
			if reply == "wrong-input" {
				input = json.RawMessage(`[{"type":"text","text":"not the sent text"}]`)
			}
			if reply == "wrong-caller" {
				caller = "somebody else"
			}
			response["result"] = map[string]any{"queuedSubmission": map[string]any{
				"id": "provider-submission", "clientUserMessageId": caller, "input": input,
			}}
			if reply == "ambiguous" {
				response["error"] = map[string]any{"code": -32603, "message": "also failed"}
			}
		}
		if err := fixtureWrite(ctx, socket, response); err != nil {
			return err
		}
		return requireClosed(ctx, socket)
	})
	client, err := connectCodex(t.Context(), endpoint, time.Now().Add(2*time.Second), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	request, err := newCodexQueueRequest(testThread, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	got := client.queue(t.Context(), request, time.Now().Add(2*time.Second))
	if again := client.queue(t.Context(), request, time.Now().Add(2*time.Second)); again.outcome != codexQueueUncertain {
		t.Fatalf("consumed client accepted retry: %+v", again)
	}
	awaitCodexFixture(t, connections, done)
	return got
}

func TestCodexConnectRefusalIsBeforeAnyDelivery(t *testing.T) {
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := newCodexEndpoint(listener.Addr().(*net.TCPAddr).AddrPort(), testCodexToken)
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	client, err := connectCodex(t.Context(), endpoint, time.Now().Add(time.Second), "fixture")
	if client != nil || !errors.Is(err, errCodexUnreachable) {
		t.Fatalf("connect = %v, %v", client != nil, err)
	}
}

func TestCodexVersionUsesProviderBuildPrefix(t *testing.T) {
	for _, version := range []string{"tmt/0.159.2 (OS) (client; 999)", "codex_cli_rs/0.159.3 (OS)", "tmt/0.160.0 (OS) (client; 0.159.3)"} {
		if !codexProviderBuild(version) {
			t.Errorf("rejected %q", version)
		}
	}
	for _, version := range []string{
		"tmt/0.159.4 (OS)", "tmt/0.160.1 (tmt; 0.160.0)", "tmt/0.160.999 (OS)", "tmt/0.161.0 (OS)",
		"tmt/0.160.0-dev", "tmt/0.160 (OS)", "tmt/0.160.0.1 (OS)", "tmt/0.159.1 (tmt; 0.159.3)",
		"0.159.3", "/0.159.3", "tmt/0.159.3-dev",
	} {
		if codexProviderBuild(version) {
			t.Errorf("accepted %q", version)
		}
	}
}

func TestCodexSlowUpgradeCannotRenewAbsoluteDeadline(t *testing.T) {
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	endpoint, err := newCodexEndpoint(listener.Addr().(*net.TCPAddr).AddrPort(), testCodexToken)
	if err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		req, err := http.ReadRequest(bufio.NewReader(conn))
		if err != nil {
			done <- err
			return
		}
		req.Body.Close()
		tick := time.NewTicker(20 * time.Millisecond)
		defer tick.Stop()
		for _, b := range []byte("HTTP/1.1 101 Switching Protocols\r\n") {
			select {
			case <-stop:
				done <- nil
				return
			case <-tick.C:
				if _, err := conn.Write([]byte{b}); err != nil {
					done <- nil
					return
				}
			}
		}
		done <- nil
	}()
	start := time.Now()
	client, err := connectCodex(t.Context(), endpoint, start.Add(150*time.Millisecond), "fixture")
	elapsed := time.Since(start)
	close(stop)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("upgrade fixture did not stop")
	}
	if client != nil || !errors.Is(err, errCodexNotReady) || elapsed >= 500*time.Millisecond {
		t.Fatalf("upgrade result = %t, %v after %v", client != nil, err, elapsed)
	}
}

func TestCodexPartialReceiptExpiresUncertainWithoutResend(t *testing.T) {
	stop := make(chan struct{})
	endpoint, connections, done := codexFixture(t, "0.159.3", func(ctx context.Context, socket *websocket.Conn, _ testQueue) error {
		writer, err := socket.Writer(ctx, websocket.MessageText)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(writer, "{"); err != nil {
			return err
		}
		tick := time.NewTicker(20 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-stop:
				return requireClosed(ctx, socket)
			case <-tick.C:
				if _, err := io.WriteString(writer, " "); err != nil {
					return requireClosed(ctx, socket)
				}
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	})
	client, err := connectCodex(t.Context(), endpoint, time.Now().Add(2*time.Second), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	request, err := newCodexQueueRequest(testThread, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	got := client.queue(t.Context(), request, start.Add(150*time.Millisecond))
	elapsed := time.Since(start)
	close(stop)
	if got.outcome != codexQueueUncertain || elapsed >= 500*time.Millisecond {
		t.Fatalf("partial receipt = %+v after %v", got, elapsed)
	}
	awaitCodexFixture(t, connections, done)
}

func TestCodexDeliveryStageGetsFreshDeadline(t *testing.T) {
	endpoint, connections, done := codexFixture(t, "0.160.0", func(ctx context.Context, socket *websocket.Conn, queue testQueue) error {
		if err := fixtureWrite(ctx, socket, map[string]any{"id": queue.ID, "result": map[string]any{"queuedSubmission": map[string]any{
			"id": "provider-submission", "clientUserMessageId": queue.Params.Caller, "input": queue.Params.Input,
		}}}); err != nil {
			return err
		}
		return requireClosed(ctx, socket)
	})
	prep, cancel := context.WithTimeout(t.Context(), 400*time.Millisecond)
	defer cancel()
	deadline, _ := prep.Deadline()
	client, err := connectCodex(t.Context(), endpoint, deadline, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	<-prep.Done()
	request, err := newCodexQueueRequest(testThread, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	if got := client.queue(t.Context(), request, time.Now().Add(time.Second)); got.outcome != codexQueueAccepted {
		t.Fatalf("delivery retained preparation deadline: %+v", got)
	}
	awaitCodexFixture(t, connections, done)
}

func TestCodexOversizedReplyIsUncertain(t *testing.T) {
	for _, mode := range []string{"single frame", "fragmented"} {
		t.Run(mode, func(t *testing.T) {
			endpoint, connections, done := codexFixture(t, "0.160.0", func(ctx context.Context, socket *websocket.Conn, queue testQueue) error {
				reply, err := json.Marshal(map[string]any{"id": queue.ID, "result": map[string]any{"queuedSubmission": map[string]any{
					"id": "provider-submission", "clientUserMessageId": queue.Params.Caller, "input": queue.Params.Input,
				}}})
				if err != nil {
					return err
				}
				padding := strings.Repeat(" ", codexFrameLimit)
				if mode == "single frame" {
					_ = socket.Write(ctx, websocket.MessageText, append([]byte(padding), reply...))
				} else {
					writer, err := socket.Writer(ctx, websocket.MessageText)
					if err != nil {
						return err
					}
					// Both data frames fit the Rust frame limit, but the
					// Go library applies its bound to the entire reply.
					if _, err := io.WriteString(writer, padding); err == nil {
						_, _ = writer.Write(reply)
					}
					_ = writer.Close()
				}
				return requireClosed(ctx, socket)
			})
			client, err := connectCodex(t.Context(), endpoint, time.Now().Add(2*time.Second), "fixture")
			if err != nil {
				t.Fatal(err)
			}
			request, err := newCodexQueueRequest(testThread, "tiny")
			if err != nil {
				t.Fatal(err)
			}
			if got := client.queue(t.Context(), request, time.Now().Add(time.Second)); got.outcome != codexQueueUncertain {
				t.Fatalf("oversized reply = %+v", got)
			}
			awaitCodexFixture(t, connections, done)
		})
	}
}

type testQueue struct {
	ID     string `json:"id"`
	Method string `json:"method"`
	Params struct {
		Thread string          `json:"threadId"`
		Caller string          `json:"clientUserMessageId"`
		Input  json.RawMessage `json:"input"`
	} `json:"params"`
}

func codexFixture(t *testing.T, build string, answer func(context.Context, *websocket.Conn, testQueue) error) (codexEndpoint, *atomic.Int32, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := newCodexEndpoint(netip.MustParseAddrPort(listener.Addr().String()), testCodexToken)
	if err != nil {
		listener.Close()
		t.Fatal(err)
	}
	var connections atomic.Int32
	done := make(chan error, 1)
	server := &http.Server{
		ReadHeaderTimeout: 2 * time.Second,
		ConnState: func(_ net.Conn, state http.ConnState) {
			if state == http.StateNew {
				connections.Add(1)
			}
		},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+testCodexToken {
				http.Error(w, "missing capability", http.StatusUnauthorized)
				done <- errors.New("missing fixture authorization")
				return
			}
			socket, err := websocket.Accept(w, r, nil)
			if err != nil {
				done <- err
				return
			}
			defer socket.CloseNow()
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			done <- runCodexFixture(ctx, socket, build, answer)
		}),
	}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return endpoint, &connections, done
}

func runCodexFixture(ctx context.Context, socket *websocket.Conn, build string, answer func(context.Context, *websocket.Conn, testQueue) error) error {
	var init testQueue
	if err := fixtureRead(ctx, socket, &init); err != nil || init.Method != "initialize" || init.ID == "" {
		return fmt.Errorf("initialize frame: %v", err)
	}
	if err := fixtureWrite(ctx, socket, map[string]any{"id": init.ID, "result": map[string]string{"userAgent": "fixture/" + build + " (fixture)"}}); err != nil {
		return err
	}
	var initialized testQueue
	if err := fixtureRead(ctx, socket, &initialized); err != nil || initialized.Method != "initialized" || initialized.ID != "" {
		return fmt.Errorf("initialized frame: %v", err)
	}
	var queue testQueue
	if err := fixtureRead(ctx, socket, &queue); err != nil || queue.Method != "thread/queue/add" ||
		queue.ID == "" || queue.Params.Thread != testThread || queue.Params.Caller == "" {
		return fmt.Errorf("queue frame: %v", err)
	}
	return answer(ctx, socket, queue)
}

func fixtureRead(ctx context.Context, socket *websocket.Conn, out any) error {
	_, bytes, err := socket.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, out)
}

func fixtureWrite(ctx context.Context, socket *websocket.Conn, value any) error {
	text, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return socket.Write(ctx, websocket.MessageText, text)
}

func requireClosed(ctx context.Context, socket *websocket.Conn) error {
	_, _, err := socket.Read(ctx)
	if err == nil || ctx.Err() != nil {
		return errors.New("client did not close after one attempt")
	}
	return nil
}

func awaitCodexFixture(t *testing.T, connections *atomic.Int32, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("Codex fixture did not stop")
	}
	if count := connections.Load(); count != 1 {
		t.Fatalf("fixture connections = %d, want one", count)
	}
}
