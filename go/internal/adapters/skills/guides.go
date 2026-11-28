package skills

import (
	"errors"
	"io/fs"
	"slices"
	"strings"
)

// Names returns the bundled guide names in publication order.
func Names() []string { return slices.Clone(names[:]) }

// ReadGuide returns the exact embedded entry for a bundled skill.
func ReadGuide(name string) ([]byte, error) {
	if !slices.Contains(names[:], name) {
		return nil, fs.ErrNotExist
	}
	return guides.ReadFile("guides/" + name + "/SKILL.md")
}

// Topics returns the bundled references for a skill in filename order.
// A known skill without references returns an empty list.
func Topics(name string) ([]string, error) {
	if !slices.Contains(names[:], name) {
		return nil, fs.ErrNotExist
	}
	entries, err := guides.ReadDir("guides/" + name + "/references")
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	topics := make([]string, 0, len(entries))
	for _, entry := range entries {
		if topic, ok := strings.CutSuffix(entry.Name(), ".md"); ok && !entry.IsDir() && validTopic(topic) {
			topics = append(topics, topic)
		}
	}
	return topics, nil
}

// ReadTopic returns the exact embedded reference. References are served
// directly from the binary and do not become part of the installed bundle.
func ReadTopic(name, topic string) ([]byte, error) {
	if !slices.Contains(names[:], name) || !validTopic(topic) {
		return nil, fs.ErrNotExist
	}
	return guides.ReadFile("guides/" + name + "/references/" + topic + ".md")
}

func validTopic(topic string) bool {
	return topic != "." && fs.ValidPath(topic) && !strings.ContainsAny(topic, "/\\")
}
