package clistyle

import (
	"fmt"
	"io"
	"math"
	"math/bits"
	"strings"
	"time"
	"unicode"
)

type Step uint8

const (
	StepDownload Step = iota
	StepVerify
	StepActivate
)

type ProgressState uint8

const (
	ProgressWaiting ProgressState = iota
	ProgressRunning
	ProgressDone
	ProgressFailed
	ProgressWarning
)

// Transfer is a caller-observed byte count and elapsed time. A zero total
// means the transfer's full size is unknown.
type Transfer struct {
	ReceivedBytes uint64
	TotalBytes    uint64
	Elapsed       time.Duration
}

type StepProgress struct {
	Step     Step
	State    ProgressState
	Transfer *Transfer
	Detail   string
}

type progressRow struct {
	state       ProgressState
	transfer    Transfer
	hasTransfer bool
	detail      string
}

var progressLabels = [...]string{"Download", "Verify", "Activate"}
var spinner = [...]string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// SpinnerTick is the interval between caller-driven spinner frames.
const SpinnerTick = 80 * time.Millisecond

// Progress renders three observed steps. Its caller owns the clock,
// terminal admission and an exclusive region during live repaint.
type Progress struct {
	title string
	rows  [len(progressLabels)]progressRow
	live  bool
	drawn bool
	frame string
}

func NewProgress(title string, live bool) *Progress {
	return &Progress{title: Escape(title), live: live, frame: "⠹"}
}

func (p *Progress) SetFrame(frame uint) {
	p.frame = spinner[frame%uint(len(spinner))]
}

func (p *Progress) Running() bool {
	for _, row := range p.rows {
		if row.state == ProgressRunning {
			return true
		}
	}
	return false
}

func (p *Progress) SetTitle(title string) {
	p.title = Escape(title)
}

func (p *Progress) Update(update StepProgress) {
	row := progressRow{state: update.State, detail: Escape(update.Detail)}
	if update.Transfer != nil {
		row.transfer = *update.Transfer
		row.hasTransfer = true
	}
	p.rows[update.Step] = row
}

func (p *Progress) Write(out io.Writer, terminal Terminal) error {
	var b strings.Builder
	if p.live && p.drawn {
		b.WriteString("\x1b[4A")
	}
	p.writeLine(&b, terminal, p.title, TokenTitle)
	for i, row := range p.rows {
		mark, token := p.mark(row.state)
		detail := row.detail
		if row.hasTransfer {
			detail = transferText(row.transfer, row.state == ProgressRunning)
		}
		p.writeLine(&b, terminal, fmt.Sprintf("%s %-12s %s", mark, progressLabels[i], detail), token)
	}
	if err := writeProgress(out, b.String()); err != nil {
		return err
	}
	p.drawn = true
	return flushProgress(out)
}

func (p *Progress) mark(state ProgressState) (string, Token) {
	switch state {
	case ProgressRunning:
		if p.frame != "" {
			return p.frame, TokenAccent
		}
		return "⠹", TokenAccent
	case ProgressDone:
		return MarkDone.Symbol(), MarkDone.Token()
	case ProgressFailed:
		return MarkFailed.Symbol(), MarkFailed.Token()
	case ProgressWarning:
		return MarkWarning.Symbol(), MarkWarning.Token()
	default:
		return "·", TokenDim
	}
}

func transferText(transfer Transfer, running bool) string {
	received := FormatBytes(transfer.ReceivedBytes)
	text := received + " downloaded"
	if total := transfer.TotalBytes; total > 0 {
		hi, lo := bits.Mul64(min(transfer.ReceivedBytes, total), 24)
		filled, _ := bits.Div64(hi, lo, total)
		text = strings.Repeat("━", int(filled)) + strings.Repeat("─", 24-int(filled)) + "  " + received + " of " + FormatBytes(total)
	}
	if running && transfer.Elapsed > 0 {
		rate := float64(transfer.ReceivedBytes) / transfer.Elapsed.Seconds()
		rateBytes := uint64(math.MaxUint64)
		if rate < float64(rateBytes) {
			rateBytes = uint64(rate)
		}
		text += " · " + FormatBytes(rateBytes) + "/s"
	}
	return text
}

func (p *Progress) writeLine(b *strings.Builder, terminal Terminal, text string, token Token) {
	if p.live {
		b.WriteString("\r\x1b[2K")
	}
	if terminal.Width != nil {
		text = Fit(text, *terminal.Width-2, AlignLeft, TruncateEnd)
	}
	text = strings.TrimRightFunc(text, unicode.IsSpace)
	b.WriteString("  ")
	mark, rest, ok := strings.Cut(text, " ")
	if token == TokenTitle || !ok {
		b.WriteString(terminal.Paint(token, text))
	} else {
		b.WriteString(terminal.Paint(token, mark))
		b.WriteByte(' ')
		label, detail, hasDetail := strings.Cut(rest, "  ")
		b.WriteString(label)
		if hasDetail {
			b.WriteString("  ")
			for i, ch := range detail {
				if !unicode.IsSpace(ch) && ch != '━' && ch != '─' {
					b.WriteString(terminal.Paint(TokenDim, detail[i:]))
					break
				}
				style := TokenDim
				if ch == '━' {
					style = TokenAccent
				}
				b.WriteString(terminal.Paint(style, string(ch)))
			}
		}
	}
	b.WriteByte('\n')
}

// HideCursor begins a live progress region. Callers pair it with ShowCursor.
func HideCursor(out io.Writer) error {
	return writeCursor(out, "\x1b[?25l")
}

// ShowCursor restores the cursor after the live progress region.
func ShowCursor(out io.Writer) error {
	return writeCursor(out, "\x1b[?25h")
}

func writeCursor(out io.Writer, sequence string) error {
	if err := writeProgress(out, sequence); err != nil {
		return err
	}
	return flushProgress(out)
}

func writeProgress(out io.Writer, text string) error {
	written, err := io.WriteString(out, text)
	if err == nil && written != len(text) {
		return io.ErrShortWrite
	}
	return err
}

func flushProgress(out io.Writer) error {
	if flusher, ok := out.(interface{ Flush() error }); ok {
		return flusher.Flush()
	}
	return nil
}

// FormatBytes uses decimal units and one fractional digit for kB and MB.
func FormatBytes(bytes uint64) string {
	switch {
	case bytes >= 1_000_000:
		return fmt.Sprintf("%.1f MB", float64(bytes)/1_000_000)
	case bytes >= 1_000:
		return fmt.Sprintf("%.1f kB", float64(bytes)/1_000)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
