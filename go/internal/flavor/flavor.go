// Package flavor names every user-visible identifier that differs between the
// isolated tmt-go experiment and the native-compatible build that replaces
// native tmt after merge (#6938). It is a stdlib-free leaf; every package that
// prints a command name, chooses a data root or writes a tmux option reads it
// here, so switching flavors is one build tag, never a code search.
//
// The default build is isolated (tmt-go names). `-tags nativecompat` builds the
// replacement: native names, native root and native tmux options. Tests of the
// native suites run that build inside private homes and tmux sockets only; it
// is installed for Ben only at the trial, after a backup. Owner: tmt-go-lead.
package flavor
