package core

const (
	DefaultRetentionDays       = 90
	MaxRetentionDays           = 3650
	RetentionDayMs             = 86_400_000
	ResponseAcceptanceWindowMs = 7 * RetentionDayMs
	MetadataSettlementFloorMs  = RetentionDayMs
	RequestMinExpiryMs         = 3_600_000
)

func ValidRetentionDays(days uint64) bool {
	return days >= 1 && days <= MaxRetentionDays
}

// CheckedDeadline computes a new deadline within the exact integer range
// shared by the native and JavaScript representations.
func CheckedDeadline(anchorMs, deltaMs uint64) (uint64, bool) {
	if anchorMs == 0 || !ValidJSSafeInteger(anchorMs) || deltaMs > MaxJSSafeInteger-anchorMs {
		return 0, false
	}
	return anchorMs + deltaMs, true
}

func RetentionDeadline(anchorMs, days uint64) (uint64, bool) {
	if !ValidRetentionDays(days) {
		return 0, false
	}
	return CheckedDeadline(anchorMs, days*RetentionDayMs)
}

// ResponseDeadlinePassed uses the later of the persisted expiry and the
// acceptance window. Subtraction avoids overflowing historical timestamps.
func ResponseDeadlinePassed(nowMs, preparedMs, expiresMs uint64) bool {
	return nowMs >= expiresMs && nowMs >= preparedMs && nowMs-preparedMs >= ResponseAcceptanceWindowMs
}
