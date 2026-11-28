package core

import (
	"errors"
	"strings"
	"testing"
)

const testIdentityID = "6c57fcc9-96b1-4022-b071-870b81288814"

func TestCanonicalIdentityID(t *testing.T) {
	if !IsCanonicalIdentityID(testIdentityID) {
		t.Fatal("canonical UUID was rejected")
	}
	for _, invalid := range []string{
		strings.ToUpper(testIdentityID),
		strings.ReplaceAll(testIdentityID, "-", ""),
		"{" + testIdentityID + "}",
		" " + testIdentityID + " ",
		"6c57fcc9-96b1-1022-b071-870b81288814",
		"6c57fcc9-96b1-4022-7071-870b81288814",
		"00000000-0000-0000-0000-000000000000",
		"worker", "%14", "fake:f1",
	} {
		if IsCanonicalIdentityID(invalid) {
			t.Errorf("accepted %q as a canonical identity UUID", invalid)
		}
	}
}

type identityReader struct {
	byID   map[IdentityID]*Identity
	byName map[string]*Identity
	err    error
}

func (r identityReader) FindByID(id IdentityID) (*Identity, error) {
	return r.byID[id], r.err
}

func (r identityReader) FindByCanonicalName(name string) (*Identity, error) {
	return r.byName[name], r.err
}

func TestResolveIdentityPrefersIDThenFallsBackToName(t *testing.T) {
	byID := &Identity{ID: testIdentityID, Name: "worker", CanonicalName: "worker"}
	byName := &Identity{ID: "an-older-id", Name: testIdentityID, CanonicalName: testIdentityID}
	records := identityReader{
		byID:   map[IdentityID]*Identity{testIdentityID: byID},
		byName: map[string]*Identity{testIdentityID: byName},
	}
	if got, err := ResolveIdentity(records, testIdentityID); got != byID || err != nil {
		t.Fatalf("ID lookup = %+v, %v", got, err)
	}
	delete(records.byID, testIdentityID)
	if got, err := ResolveIdentity(records, testIdentityID); got != byName || err != nil {
		t.Fatalf("name fallback = %+v, %v", got, err)
	}
}

func TestFindIdentityPreservesLegacyNames(t *testing.T) {
	long := strings.Repeat("a", NameLimit+1)
	legacy := &Identity{Name: Name(long), CanonicalName: long}
	pty := &Identity{Name: "PTY_ABC", CanonicalName: "pty_abc"}
	herdr := &Identity{Name: "W1:p2", CanonicalName: "w1:p2"}
	records := identityReader{byName: map[string]*Identity{long: legacy, "pty_abc": pty, "w1:p2": herdr}}
	for name, want := range records.byName {
		if got, err := FindIdentityByName(records, name); err != nil || got != want {
			t.Errorf("lookup %q = %+v, %v", name, got, err)
		}
	}
	if _, err := FindIdentityByName(records, strings.Repeat("b", NameLimit+1)); err != ErrNameTooLong {
		t.Errorf("missing long name returned %v", err)
	}
	for target, want := range map[string]bool{"%3": true, "pty_abc": false, "pty_unowned": true, "w1:p2": false} {
		if got, err := AddressesPane(records, target); got != want || err != nil {
			t.Errorf("AddressesPane(%q) = %t, %v, want %t", target, got, err, want)
		}
	}
}

func TestInvalidIdentityNamesStopBeforeStorage(t *testing.T) {
	records := identityReader{err: errors.New("unexpected repository access")}
	for _, name := range []string{"", " ", "a\x00b", "%14", "session:1.2"} {
		if _, err := FindIdentityByName(records, name); err != ErrNameEmptyOrControl && err != ErrNamePaneTarget {
			t.Errorf("FindIdentityByName(%q) = %v", name, err)
		}
	}
	if isPane, err := AddressesPane(records, "%3"); !isPane || err != nil {
		t.Errorf("AddressesPane(%%3) = %t, %v", isPane, err)
	}
}
