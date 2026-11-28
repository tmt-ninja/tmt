package core

type Lifetime string

const (
	LifetimeTemporary Lifetime = "temporary"
	LifetimeSaved     Lifetime = "saved"
)

// Identity represents an active durable identity. Storage preserves its
// historical canonical key and timestamps when reading it.
type Identity struct {
	ID            IdentityID
	Name          Name
	CanonicalName string
	Lifetime      Lifetime
	CreatedAt     string
	UpdatedAt     string
	AutoNamed     bool
}

// IdentityReader reads active identities without inferring their presence.
type IdentityReader interface {
	FindByID(IdentityID) (*Identity, error)
	FindByCanonicalName(string) (*Identity, error)
}

// IsCanonicalIdentityID recognizes lowercase RFC 4122 version 4 UUIDs.
func IsCanonicalIdentityID(value string) bool {
	if len(value) != 36 || value[14] != '4' ||
		(value[19] != '8' && value[19] != '9' && value[19] != 'a' && value[19] != 'b') {
		return false
	}
	for i := range len(value) {
		c := value[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return false
			}
		}
	}
	return true
}

// ResolveIdentity prefers an active ID over a name with the same spelling.
// An unknown UUID may still be a name.
func ResolveIdentity(records IdentityReader, selector string) (*Identity, error) {
	if IsCanonicalIdentityID(selector) {
		identity, err := records.FindByID(IdentityID(selector))
		if err != nil || identity != nil {
			return identity, err
		}
	}
	return FindIdentityByName(records, selector)
}

func FindIdentityByName(records IdentityReader, name string) (*Identity, error) {
	validated, refusal := ValidateName(name)
	if refusal == nil {
		return records.FindByCanonicalName(validated.CanonicalName())
	}
	legacy, err := ValidateExistingName(name)
	if err != nil {
		return nil, err
	}
	identity, err := records.FindByCanonicalName(legacy.CanonicalName())
	if err != nil || identity != nil {
		return identity, err
	}
	return nil, refusal
}

// AddressesPane lets an existing identity keep a name subsequently reserved
// by a host. tmux targets have always been reserved.
func AddressesPane(records IdentityReader, selector string) (bool, error) {
	if !IsPaneTarget(selector) {
		return false, nil
	}
	name, err := ValidateExistingName(selector)
	if err != nil {
		return true, nil
	}
	identity, err := records.FindByCanonicalName(name.CanonicalName())
	return err == nil && identity == nil, err
}
