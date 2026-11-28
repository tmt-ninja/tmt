package tmuxtest

import (
	"strings"
	"testing"
)

func TestPrivateServerIsNotHostDefault(t *testing.T) {
	s := Start(t)
	if sameFile(s.Socket, HostDefaultSocket()) {
		t.Fatal("private socket equals host default")
	}
	if got := s.Run("display-message", "-p", "#{socket_path}"); !strings.Contains(got, s.Socket) {
		t.Fatalf("server answered on %q, want %q", got, s.Socket)
	}
}
