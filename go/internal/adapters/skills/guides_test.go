package skills

import (
	"bytes"
	"errors"
	"io/fs"
	"slices"
	"testing"
)

func TestReadBundledGuides(t *testing.T) {
	names := Names()
	if !slices.Equal(names, []string{"tmt", "tmt-inbox"}) {
		t.Fatalf("guide names = %v", names)
	}
	for _, name := range names {
		want, err := guides.ReadFile("guides/" + name + "/SKILL.md")
		if err != nil {
			t.Fatal(err)
		}
		got, err := ReadGuide(name)
		if err != nil || !bytes.Equal(got, want) || len(got) == 0 {
			t.Fatalf("guide %s was not read exactly: %v", name, err)
		}
		topics, err := Topics(name)
		if err != nil || topics == nil || len(topics) != 0 {
			t.Fatalf("Go skill %s topics = %v, %v; it has no bundled references", name, topics, err)
		}
	}
	if _, err := ReadGuide("../guides/tmt"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("path selector = %v", err)
	}
	if _, err := Topics("missing"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("unknown guide topics = %v", err)
	}
	for _, topic := range []string{"run", "../SKILL", "nested/file"} {
		if _, err := ReadTopic("tmt", topic); !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("topic %q = %v", topic, err)
		}
	}
}
