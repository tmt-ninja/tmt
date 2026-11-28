package cli

import (
	_ "embed"
	"encoding/json"
	"io"
	"maps"
	"os"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// The native public grammar's help pages, captured with CLICOLOR_FORCE=1,
// redirected stdout, a private home and no discovered extensions. Keep the
// rendered rows so Clap's padding, option ordering and value annotations
// survive. TestHelpMatchesNative checks this projection against the oracle.
//
//go:embed help_native.json
var nativeHelpJSON []byte

var helpPages = loadHelpPages()

var helpStyleCodes = strings.NewReplacer("\x1b[0m", "", "\x1b[1m", "", "\x1b[2m", "")
var nativeProgram = regexp.MustCompile(`(?:^|[^[:alnum:]_.-]|\x1b\[[0-9]+m)(tmt)\b`)

func loadHelpPages() map[string]string {
	var pages map[string]string
	if err := json.Unmarshal(nativeHelpJSON, &pages); err != nil {
		panic(err)
	}
	for path, page := range pages {
		var text strings.Builder
		start := 0
		for _, match := range nativeProgram.FindAllStringSubmatchIndex(page, -1) {
			left, right := match[2], match[3]
			if right < len(page) && strings.ContainsRune(".-", rune(page[right])) {
				continue
			}
			text.WriteString(page[start:left])
			text.WriteString(grammar.name)
			start = right
		}
		text.WriteString(page[start:])
		pages[path] = text.String()
	}
	return pages
}

func registerPublicHelpTopics(root *commandSpec) {
	for _, path := range slices.Sorted(maps.Keys(helpPages)) {
		command := root
		for _, name := range strings.Fields(path) {
			child := command.child(name)
			if child == nil {
				command.children = append(command.children, commandSpec{name: name})
				child = &command.children[len(command.children)-1]
			}
			command = child
		}
	}
}

func renderHelp(w io.Writer, path []string) error {
	page := helpPages[strings.Join(path, " ")]
	if file, ok := w.(*os.File); ok {
		if width, ok := clistyle.ProbeWidth(file); ok {
			if width >= 40 {
				page = wrapHelp(page, width)
			}
			if os.Getenv("NO_COLOR") == "" && os.Getenv("CLICOLOR") != "0" && os.Getenv("TERM") != "dumb" {
				_, err := io.WriteString(w, page)
				return err
			}
		}
	}
	_, err := io.WriteString(w, helpStyleCodes.Replace(page))
	return err
}

func wrapHelp(page string, width int) string {
	var out strings.Builder
	inExamples := false
	for line := range strings.SplitSeq(page, "\n") {
		plain := helpStyleCodes.Replace(line)
		content := strings.TrimLeftFunc(plain, unicode.IsSpace)
		inExamples = inExamples || content == "Examples:"
		if out.Len() != 0 {
			out.WriteByte('\n')
		}
		if inExamples || strings.HasPrefix(content, "Usage:") || content == grammar.name ||
			strings.HasPrefix(content, grammar.name+" ") || clistyle.DisplayWidth(plain) <= width {
			out.WriteString(line)
			continue
		}
		indent := plain[:len(plain)-len(content)]
		if gap := strings.Index(content, "  "); gap >= 0 {
			description := strings.TrimLeftFunc(content[gap:], unicode.IsSpace)
			column := clistyle.DisplayWidth(plain[:len(plain)-len(description)])
			if description != "" && width-column >= 20 {
				indent = strings.Repeat(" ", column)
			}
		}
		wrapHelpLine(&out, line, indent, width)
	}
	return out.String()
}

func wrapHelpLine(out *strings.Builder, line, indent string, width int) {
	column := 0
	hasWord := false
	for {
		start := strings.IndexFunc(line, func(ch rune) bool { return !unicode.IsSpace(ch) })
		if start < 0 {
			out.WriteString(line)
			return
		}
		gap, tail := line[:start], line[start:]
		end := strings.IndexFunc(tail, unicode.IsSpace)
		if end < 0 {
			end = len(tail)
		}
		word := tail[:end]
		gapWidth := clistyle.DisplayWidth(gap)
		wordWidth := clistyle.DisplayWidth(helpStyleCodes.Replace(word))
		if hasWord && wordWidth > 0 && column+gapWidth+wordWidth > width {
			out.WriteByte('\n')
			out.WriteString(indent)
			column = clistyle.DisplayWidth(indent)
		} else {
			out.WriteString(gap)
			column += gapWidth
		}
		out.WriteString(word)
		column += wordWidth
		hasWord = hasWord || wordWidth > 0
		line = tail[end:]
	}
}
