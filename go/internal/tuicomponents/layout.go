package tuicomponents

import (
	"encoding/json"
	"errors"
)

// TrackKind distinguishes fixed-cell tracks from weighted fill tracks.
type TrackKind uint8

const (
	TrackKindFixed TrackKind = iota
	TrackKindFill
)

// Track is a fixed track, or a weighted share of the space left after fixed tracks.
type Track struct {
	Kind  TrackKind
	Value uint16
}

// FixedTrack constructs a fixed-length Track.
func FixedTrack(n uint16) Track {
	return Track{Kind: TrackKindFixed, Value: n}
}

// FillTrack constructs a weighted fill Track.
func FillTrack(weight uint16) Track {
	return Track{Kind: TrackKindFill, Value: weight}
}

func (t Track) MarshalJSON() ([]byte, error) {
	switch t.Kind {
	case TrackKindFixed:
		return json.Marshal(struct {
			Fixed uint16 `json:"fixed"`
		}{Fixed: t.Value})
	case TrackKindFill:
		return json.Marshal(struct {
			Fill uint16 `json:"fill"`
		}{Fill: t.Value})
	default:
		return nil, errors.New("unknown track kind")
	}
}

func (t *Track) UnmarshalJSON(data []byte) error {
	var raw map[string]uint16
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if len(raw) != 1 {
		return errors.New("track must be an object with exactly one key")
	}
	if v, ok := raw["fixed"]; ok {
		*t = FixedTrack(v)
		return nil
	}
	if v, ok := raw["fill"]; ok {
		*t = FillTrack(v)
		return nil
	}
	return errors.New("unknown track kind")
}

// Split divides an area into rows or columns, clipping fixed tracks and
// distributing remainder deterministically.
func Split(area Rect, tracks []Track, horizontal bool) []Rect {
	available := area.Height
	if horizontal {
		available = area.Width
	}
	var fixed, weight uint32
	for _, t := range tracks {
		switch t.Kind {
		case TrackKindFixed:
			fixed += uint32(t.Value)
		case TrackKindFill:
			weight += uint32(t.Value)
		}
	}
	var free uint32
	if uint32(available) > fixed {
		free = uint32(available) - fixed
	}
	var offset uint16
	var allocated, seen uint32
	out := make([]Rect, len(tracks))
	for i, track := range tracks {
		var want uint32
		switch track.Kind {
		case TrackKindFixed:
			want = uint32(track.Value)
		case TrackKindFill:
			if weight > 0 {
				seen += uint32(track.Value)
				end := free * seen / weight
				want = end - allocated
				allocated = end
			}
		}
		rem := uint32(satSubU16(available, offset))
		length := uint16(min(want, rem))
		r := area
		if horizontal {
			r.X = satAddU16(area.X, offset)
			r.Width = length
		} else {
			r.Y = satAddU16(area.Y, offset)
			r.Height = length
		}
		offset += length
		out[i] = r
	}
	return out
}

// Row lays out fixed and fill tracks from left to right.
func Row(area Rect, tracks []Track) []Rect {
	return Split(area, tracks, true)
}

// Column lays out fixed and fill tracks from top to bottom.
func Column(area Rect, tracks []Track) []Rect {
	return Split(area, tracks, false)
}
