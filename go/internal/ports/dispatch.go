package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// RoomDispatcher atomically enqueues a frozen room audience and its receipt.
type RoomDispatcher interface {
	DispatchRoom(context.Context, core.RoomDispatchInput) (core.DispatchReceipt, error)
}
