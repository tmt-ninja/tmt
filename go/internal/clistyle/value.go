package clistyle

import (
	"fmt"
	"strings"
	"time"
)

// ShortIDLength is the number of Unicode characters displayed for an ID.
const ShortIDLength = 8

// ShortID abbreviates human-facing values. Values a reader must type, such
// as request IDs and receipts, keep their full text.
func ShortID(id string) string {
	count := 0
	for i := range id {
		if count == ShortIDLength {
			return id[:i]
		}
		count++
	}
	return id
}

func Address(driver, id string) string {
	return driver + ":" + ShortID(id)
}

// HomePath abbreviates an absolute path lexically below a supplied home.
func HomePath(path, home string) string {
	if !strings.HasPrefix(home, "/") || !strings.HasPrefix(path, "/") {
		return path
	}
	dir := strings.TrimRight(home, "/")
	if path == dir || strings.TrimRight(path, "/") == dir {
		return "~"
	}
	if relative, ok := strings.CutPrefix(path, dir+"/"); ok {
		return "~/" + strings.TrimLeft(relative, "/")
	}
	return path
}

// RelativeTime reports elapsed time in its largest whole unit.
func RelativeTime(elapsed time.Duration) string {
	switch {
	case elapsed < 5*time.Second:
		return "just now"
	case elapsed < time.Minute:
		return fmt.Sprintf("%ds ago", elapsed/time.Second)
	case elapsed < time.Hour:
		return fmt.Sprintf("%dm ago", elapsed/time.Minute)
	case elapsed < 24*time.Hour:
		return fmt.Sprintf("%dh ago", elapsed/time.Hour)
	default:
		return fmt.Sprintf("%dd ago", elapsed/(24*time.Hour))
	}
}
