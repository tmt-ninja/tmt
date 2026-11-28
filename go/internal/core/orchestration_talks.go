package core

type OrchTalkFactsMode string

const (
	OrchTalkFactsTalks     OrchTalkFactsMode = "talks"
	OrchTalkFactsRoutesNow OrchTalkFactsMode = "routesNow"
	OrchTalkFactsRoutesAt  OrchTalkFactsMode = "routesAt"
)

func (mode OrchTalkFactsMode) Valid() bool {
	switch mode {
	case OrchTalkFactsTalks, OrchTalkFactsRoutesNow, OrchTalkFactsRoutesAt:
		return true
	default:
		return false
	}
}

type OrchTalkFactsQuery struct {
	MemberQuery  *string
	ObservedAtMs uint64
	Mode         OrchTalkFactsMode
}

type OrchTalkFactsPage struct {
	Policy      OrchPolicySnapshot
	SelectedIDs []IdentityID
	Pairs       []OrchTalkPair
}

type OrchTalkPair struct {
	FirstID, SecondID IdentityID
	Count             uint64
	LastAtMs          *uint64
	WindowStartMs     uint64
	HeldCount         uint64
	Held              []OrchHeldTalk
	HasLiveHold       bool
}

type OrchHeldTalk struct {
	RequestID             RequestID
	FromID, ToID          IdentityID
	HeldAtMs, ExpiresAtMs uint64
}

type OrchSendingRoute string

const (
	OrchSendingAllowed    OrchSendingRoute = "allowed"
	OrchSendingGranted    OrchSendingRoute = "granted"
	OrchSendingRestricted OrchSendingRoute = "restricted"
)

func (route OrchSendingRoute) Valid() bool {
	return route == OrchSendingAllowed || route == OrchSendingGranted || route == OrchSendingRestricted
}

type OrchSendingEvidence struct {
	AtMs, GrantUntilMs            uint64
	Count                         *uint64
	SenderIsLead, RecipientIsLead bool
}

type OrchSendingDecision struct {
	Route       OrchSendingRoute
	PairLimit   *uint32
	LimitSource OrchSource
	NeedsPerson bool
}

func OrchPairLimit(first, second *uint32) *uint32 {
	if first != nil && (second == nil || *first < *second) {
		return first
	}
	return second
}

// ResolveOrchSending evaluates the route and pair limit independently.
// A live grant admits the route while the writer may still hold the request.
func ResolveOrchSending(sender, recipient OrchEffective, evidence OrchSendingEvidence) OrchSendingDecision {
	decision := OrchSendingDecision{Route: OrchSendingAllowed}
	sending := sender.Sending.Value
	if sending != "anyone" && !(sending == "leads" && evidence.RecipientIsLead) {
		decision.Route = OrchSendingRestricted
		if evidence.AtMs < evidence.GrantUntilMs {
			decision.Route = OrchSendingGranted
		}
	}
	decision.PairLimit = OrchPairLimit(sender.TalkLimit.Value, recipient.TalkLimit.Value)
	if decision.PairLimit == nil {
		return decision
	}
	decision.LimitSource = sender.TalkLimit.Source
	if limit := recipient.TalkLimit.Value; limit != nil && *limit == *decision.PairLimit {
		decision.LimitSource = recipient.TalkLimit.Source
	}
	decision.NeedsPerson = decision.Route != OrchSendingRestricted && !evidence.SenderIsLead &&
		evidence.Count != nil && *evidence.Count >= uint64(*decision.PairLimit)
	return decision
}
