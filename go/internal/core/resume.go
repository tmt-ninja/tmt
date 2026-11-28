package core

// ResumeRuntimeMode is a stored provider-owned mode identifier.
type ResumeRuntimeMode string

type ResumeDriverState struct {
	Version uint16
	JSON    string
}

// ResumeFence binds saved provider coordinates across binding changes.
type ResumeFence struct {
	Version uint8
	Digest  [32]byte
}

type ResumeSession struct {
	Driver            DriverName
	Mode              ResumeRuntimeMode
	ProviderSession   string
	Channel           *bool
	State             *ResumeDriverState
	StaleAtMs         *uint64
	PendingAtMs       *uint64
	HasMatchingPreset bool
}

// ResumeLaunchPreset is the validated, read-only preset projection.
type ResumeLaunchPreset struct {
	Executable string
	Model      *string
	Effort     *string
	Env        map[string]string
	Associated bool
}

type ResumeSnapshot struct {
	Identity        Identity
	PriorBinding    *Binding
	PreferredDriver *DriverName
	Selected        *ResumeSession
	LaunchPreset    *ResumeLaunchPreset
	ReplayPreset    *ResumeLaunchPreset
	ResumeModel     *string
	Fence           ResumeFence
}

// ResumeExpectation pins the selected session after binding activation.
type ResumeExpectation struct {
	IdentityID      IdentityID
	Driver          DriverName
	ProviderSession string
	Fence           ResumeFence
}
