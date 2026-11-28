package core

const (
	MaxObserverTimeoutSeconds = 86_400
	MaxTimerDelayMs           = 2_147_483_647
	MaxCaptureLines           = 2_147_483_647
	MaxJSSafeInteger          = 9_007_199_254_740_991
)

func ValidObserverTimeoutSeconds(value float64) bool {
	return value > 0 && value <= MaxObserverTimeoutSeconds
}

func ValidTimerDelayMs(value float64) bool {
	return value >= 0 && value <= MaxTimerDelayMs
}

func ValidCaptureLines(value uint64) bool {
	return value <= MaxCaptureLines
}

func ValidJSSafeInteger(value uint64) bool {
	return value <= MaxJSSafeInteger
}
