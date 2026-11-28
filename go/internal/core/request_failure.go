package core

// RequestFailure is an expected request rejection with a native command code,
// public-safe message, and process exit status. Unexpected repository errors
// remain separate so callers can render a sanitized fallback.
type RequestFailure struct {
	Code       string
	Message    string
	Status     int
	Reason     string
	Stage      string
	Suggestion string
}

func (f *RequestFailure) Error() string {
	return f.Message
}
