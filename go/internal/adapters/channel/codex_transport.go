//go:build darwin || linux

package channel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

const (
	codexStageBudget = 3 * time.Second
	codexFrameLimit  = 256 * 1024
	codexEventLimit  = 256
)

var (
	errCodexEndpoint         = errors.New("invalid owned Codex endpoint")
	errCodexUnreachable      = errors.New("owned Codex endpoint is unreachable")
	errCodexNotReady         = errors.New("owned Codex endpoint did not initialize")
	errCodexUnsupportedBuild = errors.New("owned Codex endpoint build is unsupported")
	errCodexUncertain        = errors.New("Codex channel exchange is uncertain")
)

type codexEndpoint struct {
	address netip.AddrPort
	token   string
}

// The caller must prove ownership before constructing an endpoint. Shape
// validation alone cannot authorize connection to an app-server.
func newCodexEndpoint(address netip.AddrPort, token string) (codexEndpoint, error) {
	if !address.Addr().Is4() || !address.Addr().IsLoopback() || address.Port() == 0 || len(token) == 0 || len(token) > 512 {
		return codexEndpoint{}, errCodexEndpoint
	}
	for _, ch := range token {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return codexEndpoint{}, errCodexEndpoint
		}
	}
	return codexEndpoint{address: address, token: token}, nil
}

type codexClient struct {
	socket   *websocket.Conn
	stream   net.Conn
	deadline time.Time
	events   atomic.Uint32
	consumed atomic.Bool
}

// connectCodex spends the caller's preparation deadline on TCP connect,
// WebSocket upgrade and initialize together. It never reconnects.
func connectCodex(ctx context.Context, endpoint codexEndpoint, deadline time.Time, version string) (*codexClient, error) {
	if _, err := newCodexEndpoint(endpoint.address, endpoint.token); err != nil {
		return nil, err
	}
	deadline = codexDeadline(ctx, deadline)
	stage, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	if stage.Err() != nil {
		return nil, errCodexUnreachable
	}
	address := endpoint.address.String()
	stream, err := (&net.Dialer{}).DialContext(stage, "tcp4", address)
	if err != nil {
		return nil, errCodexUnreachable
	}
	client := &codexClient{stream: stream, deadline: deadline}
	success := false
	defer func() {
		if !success {
			client.close()
		}
	}()
	if stream.SetDeadline(deadline) != nil {
		return nil, errCodexNotReady
	}
	var supplied atomic.Bool
	transport := &http.Transport{
		DialContext: func(_ context.Context, network, target string) (net.Conn, error) {
			if network != "tcp" || target != address || !supplied.CompareAndSwap(false, true) {
				return nil, errCodexEndpoint
			}
			return stream, nil
		},
		MaxResponseHeaderBytes: 32 * 1024,
	}
	httpClient := &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	onControl := func() bool {
		if client.events.Add(1) >= codexEventLimit {
			_ = stream.SetDeadline(time.Now())
			return false
		}
		return true
	}
	client.socket, _, err = websocket.Dial(stage, "ws://"+address, &websocket.DialOptions{
		HTTPClient: httpClient, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + endpoint.token}},
		OnPingReceived: func(context.Context, []byte) bool { return onControl() },
		OnPongReceived: func(context.Context, []byte) { onControl() },
	})
	if err != nil || stage.Err() != nil {
		return nil, errCodexNotReady
	}
	// NOT PORTED (#6938): coder/websocket exposes a complete-message limit,
	// so Go accepts an individual inbound frame above Rust's 256 KiB frame
	// cap. Both implementations enforce the 1 MiB message cap.
	client.socket.SetReadLimit(codexResponseLimit)
	id := launchGeneration()
	reply, err := client.call(stage, id, map[string]any{"id": id, "method": "initialize", "params": map[string]any{
		"clientInfo":   map[string]string{"name": "tmt", "version": version},
		"capabilities": map[string]bool{"experimentalApi": true},
	}})
	if err != nil || reply["error"] != nil {
		return nil, errCodexNotReady
	}
	result, err := strictObject(reply["result"])
	userAgent := codexString(result["userAgent"])
	if err != nil || userAgent == "" {
		return nil, errCodexNotReady
	}
	if !codexProviderBuild(userAgent) {
		return nil, errCodexUnsupportedBuild
	}
	if err := client.write(stage, map[string]string{"method": "initialized"}); err != nil {
		return nil, errCodexNotReady
	}
	success = true
	return client, nil
}

func (c *codexClient) close() {
	if c.socket != nil {
		_ = c.socket.CloseNow()
	}
	_ = c.stream.Close()
}

// queue consumes one initialized client. It alone starts a fresh absolute
// deadline after final endpoint verification. The caller cannot retry.
func (c *codexClient) queue(ctx context.Context, request codexQueueRequest, deadline time.Time) codexQueueResult {
	if !c.consumed.CompareAndSwap(false, true) {
		return codexQueueResult{}
	}
	defer c.close()
	c.deadline = codexDeadline(ctx, deadline)
	if ctx.Err() != nil || !time.Now().Before(c.deadline) || c.stream.SetDeadline(c.deadline) != nil {
		return codexQueueResult{}
	}
	reply, err := c.call(ctx, request.id, request.frame())
	if err != nil {
		return codexQueueResult{}
	}
	return request.receipt(reply)
}

func (c *codexClient) call(ctx context.Context, id string, request any) (map[string]json.RawMessage, error) {
	ctx, cancel := context.WithDeadline(ctx, c.deadline)
	defer cancel()
	c.events.Store(0)
	if err := c.write(ctx, request); err != nil {
		return nil, err
	}
	for c.events.Load() < codexEventLimit {
		typ, raw, err := c.socket.Read(ctx)
		if err != nil || ctx.Err() != nil || !time.Now().Before(c.deadline) || typ != websocket.MessageText || len(raw) > codexResponseLimit || !utf8.Valid(raw) ||
			c.events.Add(1) > codexEventLimit {
			return nil, errCodexUncertain
		}
		response, err := strictObject(raw)
		if err != nil {
			return nil, errCodexUncertain
		}
		if codexString(response["id"]) == id && response["method"] == nil {
			return response, nil
		}
		if response["id"] != nil || codexString(response["method"]) == "" || response["result"] != nil || response["error"] != nil {
			return nil, errCodexUncertain
		}
	}
	return nil, errCodexUncertain
}

func (c *codexClient) write(ctx context.Context, request any) error {
	raw, err := json.Marshal(request)
	if err != nil || ctx.Err() != nil || !time.Now().Before(c.deadline) {
		return errCodexUncertain
	}
	if len(raw) <= codexFrameLimit {
		if c.socket.Write(ctx, websocket.MessageText, raw) != nil {
			return errCodexUncertain
		}
		return nil
	}
	writer, err := c.socket.Writer(ctx, websocket.MessageText)
	if err != nil {
		return errCodexUncertain
	}
	for len(raw) > 0 {
		size := min(len(raw), codexFrameLimit)
		n, err := writer.Write(raw[:size])
		if err != nil || n != size {
			return errors.Join(errCodexUncertain, io.ErrShortWrite)
		}
		raw = raw[size:]
	}
	if writer.Close() != nil {
		return errCodexUncertain
	}
	return nil
}

func codexDeadline(ctx context.Context, requested time.Time) time.Time {
	deadline := requested
	if deadline.IsZero() {
		deadline = time.Now().Add(codexStageBudget)
	}
	if bound, ok := ctx.Deadline(); ok && bound.Before(deadline) {
		deadline = bound
	}
	return deadline
}

func codexProviderBuild(userAgent string) bool {
	prefix, _, _ := strings.Cut(strings.TrimLeft(userAgent, " \t\n\r\v\f"), " ")
	if end := strings.IndexAny(prefix, "\t\n\r\v\f"); end >= 0 {
		prefix = prefix[:end]
	}
	name, version, ok := strings.Cut(prefix, "/")
	return ok && name != "" && (version == "0.159.2" || version == "0.159.3" || version == "0.160.0")
}
