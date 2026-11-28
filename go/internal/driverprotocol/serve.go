package driverprotocol

import (
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strconv"
)

// Handler is implemented by a host driver. Embed BaseHandler to inherit default
// unsupported responses for operations the driver does not implement.
type Handler interface {
	Capabilities() Capabilities
	Caller(Request[CallerRequest]) (CallerResponse, *DriverError)
	Server(Request[ServerRequest]) (ServerResponse, *DriverError)
	ResolveTarget(Request[ResolveTargetRequest]) (ResolveTargetResponse, *DriverError)
	Snapshot(Request[SnapshotRequest]) (SnapshotResponse, *DriverError)
	Probe(Request[ProbeRequest]) (ProbeResponse, *DriverError)
	Publish(Request[PublishRequest]) *DriverError
	Clear(Request[ClearRequest]) (ClearResponse, *DriverError)
	Capture(Request[CaptureRequest]) (CaptureResponse, *DriverError)
	Input(Request[InputRequest]) *DriverError
	Prompt(Request[PromptRequest]) *DriverError
	Focus(Request[FocusRequest]) (FocusResponse, *DriverError)
	Close(Request[CloseRequest]) *DriverError
	NameAgent(Request[NameAgentRequest]) *DriverError
}

// BaseHandler provides default unsupported implementations for every host operation
// except Capabilities.
type BaseHandler struct{}

func (BaseHandler) Caller(Request[CallerRequest]) (CallerResponse, *DriverError) {
	return CallerResponse{}, unsupported(OpCaller)
}
func (BaseHandler) Server(Request[ServerRequest]) (ServerResponse, *DriverError) {
	return ServerResponse{}, unsupported(OpServer)
}
func (BaseHandler) ResolveTarget(Request[ResolveTargetRequest]) (ResolveTargetResponse, *DriverError) {
	return ResolveTargetResponse{}, unsupported(OpResolveTarget)
}
func (BaseHandler) Snapshot(Request[SnapshotRequest]) (SnapshotResponse, *DriverError) {
	return SnapshotResponse{}, unsupported(OpSnapshot)
}
func (BaseHandler) Probe(Request[ProbeRequest]) (ProbeResponse, *DriverError) {
	return ProbeResponse{}, unsupported(OpProbe)
}
func (BaseHandler) Publish(Request[PublishRequest]) *DriverError {
	return unsupported(OpPublish)
}
func (BaseHandler) Clear(Request[ClearRequest]) (ClearResponse, *DriverError) {
	return ClearResponse{}, unsupported(OpClear)
}
func (BaseHandler) Capture(Request[CaptureRequest]) (CaptureResponse, *DriverError) {
	return CaptureResponse{}, unsupported(OpCapture)
}
func (BaseHandler) Input(Request[InputRequest]) *DriverError {
	return unsupported(OpInput)
}
func (BaseHandler) Prompt(Request[PromptRequest]) *DriverError {
	return unsupported(OpPrompt)
}
func (BaseHandler) Focus(Request[FocusRequest]) (FocusResponse, *DriverError) {
	return FocusResponse{}, unsupported(OpFocus)
}
func (BaseHandler) Close(Request[CloseRequest]) *DriverError {
	return unsupported(OpClose)
}
func (BaseHandler) NameAgent(Request[NameAgentRequest]) *DriverError {
	return unsupported(OpNameAgent)
}

// RuntimeHandler is implemented by a runtime driver. Locations is required; embed
// BaseRuntimeHandler for default unsupported Resume and Usage implementations.
type RuntimeHandler interface {
	Capabilities() RuntimeCapabilities
	Locations(Request[LocationsRequest]) (LocationsResponse, *DriverError)
	Resume(Request[ResumeRequest]) (ResumeResponse, *DriverError)
	Usage(Request[UsageRequest]) (UsageResponse, *DriverError)
}

// BaseRuntimeHandler provides default unsupported implementations for optional runtime ops.
type BaseRuntimeHandler struct{}

func (BaseRuntimeHandler) Resume(Request[ResumeRequest]) (ResumeResponse, *DriverError) {
	return ResumeResponse{}, unsupported(OpResume)
}
func (BaseRuntimeHandler) Usage(Request[UsageRequest]) (UsageResponse, *DriverError) {
	return UsageResponse{}, unsupported(OpUsage)
}

type dispatcher interface {
	declare() ([]byte, []string)
	answer(op Op, request []byte) []byte
}

type hostDispatch struct{ h Handler }

func (d hostDispatch) declare() ([]byte, []string) {
	caps := d.h.Capabilities()
	return boundedResponse(OpCapabilities, &caps, nil), slices.Clone(caps.Ops)
}

func (d hostDispatch) answer(op Op, request []byte) []byte {
	switch op {
	case OpCaller:
		return callOp(op, request, d.h.Caller)
	case OpServer:
		return callOp(op, request, d.h.Server)
	case OpResolveTarget:
		return callOp(op, request, d.h.ResolveTarget)
	case OpSnapshot:
		return callOp(op, request, d.h.Snapshot)
	case OpProbe:
		return callOp(op, request, d.h.Probe)
	case OpPublish:
		return callEmptyOp(op, request, d.h.Publish)
	case OpClear:
		return callOp(op, request, d.h.Clear)
	case OpCapture:
		return callOp(op, request, d.h.Capture)
	case OpInput:
		return callEmptyOp(op, request, d.h.Input)
	case OpPrompt:
		return callEmptyOp(op, request, d.h.Prompt)
	case OpFocus:
		return callOp(op, request, d.h.Focus)
	case OpClose:
		return callEmptyOp(op, request, d.h.Close)
	case OpNameAgent:
		return callEmptyOp(op, request, d.h.NameAgent)
	default:
		return encodeError(unsupported(op))
	}
}

type runtimeDispatch struct{ h RuntimeHandler }

func (d runtimeDispatch) declare() ([]byte, []string) {
	caps := d.h.Capabilities()
	return boundedResponse(OpCapabilities, &caps, nil), slices.Clone(caps.Ops)
}

func (d runtimeDispatch) answer(op Op, request []byte) []byte {
	switch op {
	case OpLocations:
		return callOp(op, request, d.h.Locations)
	case OpResume:
		return callOp(op, request, d.h.Resume)
	case OpUsage:
		return callOp(op, request, d.h.Usage)
	default:
		return encodeError(unsupported(op))
	}
}

func unsupported(op Op) *DriverError {
	return NewDriverError(ErrorUnsupported, fmt.Sprintf("%s is not supported", op))
}

func badRequest(message string) *DriverError {
	return NewDriverError(ErrorBadRequest, message)
}

// Serve answers one `__tmt-driver <protocol> <op>` host-driver invocation.
// args are the arguments after the program name. Returns exit status 0 whenever an answer
// was printed, 2 when the invocation itself was malformed (an error answer is still printed),
// or 1 if writing the answer failed.
func Serve(args []string, input io.Reader, output io.Writer, handler Handler) int {
	return serveDispatch(args, input, output, hostDispatch{h: handler})
}

// ServeRuntime is Serve for a runtime driver.
func ServeRuntime(args []string, input io.Reader, output io.Writer, handler RuntimeHandler) int {
	return serveDispatch(args, input, output, runtimeDispatch{h: handler})
}

func serveDispatch(args []string, input io.Reader, output io.Writer, driver dispatcher) int {
	var status int
	var reply []byte
	if len(args) == 3 && args[0] == Subcommand {
		proto, err := strconv.ParseUint(args[1], 10, 32)
		if err != nil || uint32(proto) != Protocol {
			status = 2
			reply = encodeError(badRequest(fmt.Sprintf("protocol %s is not spoken", args[1])))
		} else if op, ok := ParseOp(args[2]); ok {
			status = 0
			reply = answerOp(op, input, driver)
		} else {
			status = 0
			reply = encodeError(NewDriverError(ErrorUnsupported, fmt.Sprintf("unknown operation %s", args[2])))
		}
	} else {
		status = 2
		reply = encodeError(badRequest(fmt.Sprintf("usage: %s <protocol> <op>", Subcommand)))
	}
	if _, err := output.Write(reply); err != nil {
		return 1
	}
	return status
}

func encodeError(derr *DriverError) []byte {
	b, err := json.Marshal(Response[Empty]{Error: derr})
	if err != nil {
		panic(fmt.Sprintf("driver error serialization failed: %v", err))
	}
	return b
}

func answerOp(op Op, input io.Reader, driver dispatcher) []byte {
	capsBytes, declared := driver.declare()
	if op == OpCapabilities {
		return capsBytes
	}
	if !slices.Contains(declared, op.String()) {
		return encodeError(unsupported(op))
	}
	reqBytes, err := io.ReadAll(io.LimitReader(input, MaxRequestBytes+1))
	if err != nil {
		return encodeError(badRequest("the request could not be read"))
	}
	if len(reqBytes) > MaxRequestBytes {
		return encodeError(badRequest("the request is over 1 MiB"))
	}
	return driver.answer(op, reqBytes)
}

func callOp[T any, U any](op Op, reqBytes []byte, handle func(Request[T]) (U, *DriverError)) []byte {
	var req Request[T]
	if err := unmarshalExact(reqBytes, &req); err != nil {
		return encodeError(badRequest(fmt.Sprintf("the request is invalid: %v", err)))
	}
	val, derr := handle(req)
	if derr != nil {
		return boundedResponse[U](op, nil, derr)
	}
	return boundedResponse(op, &val, nil)
}

func callEmptyOp[T any](op Op, reqBytes []byte, handle func(Request[T]) *DriverError) []byte {
	var req Request[T]
	if err := unmarshalExact(reqBytes, &req); err != nil {
		return encodeError(badRequest(fmt.Sprintf("the request is invalid: %v", err)))
	}
	if derr := handle(req); derr != nil {
		return boundedResponse[Empty](op, nil, derr)
	}
	empty := Empty{}
	return boundedResponse(op, &empty, nil)
}

func boundedResponse[U any](op Op, val *U, derr *DriverError) []byte {
	var resp Response[U]
	if derr != nil {
		resp.Error = derr
	} else {
		resp.Ok = val
	}
	b, err := json.Marshal(resp)
	if err != nil {
		panic(fmt.Sprintf("driver response serialization failed: %v", err))
	}
	if len(b) > op.Bounds().MaxOutputBytes {
		return encodeError(NewDriverError(ErrorFailed, fmt.Sprintf("the %s answer is over its bound", op)))
	}
	return b
}
