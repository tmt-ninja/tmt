package core

import "testing"

func TestResolveOrchSendingKeepsGrantAndPairLimitIndependent(t *testing.T) {
	senderSource := OrchSource{Kind: OrchSourcePlan, Revision: 3}
	recipientSource := OrchSource{Kind: OrchSourceMember, Revision: 4}
	first, second := uint32(2), uint32(2)
	sender := OrchEffective{
		Sending:   OrchEffectiveField[OrchSending]{Value: "paused", Source: senderSource},
		TalkLimit: OrchEffectiveField[*uint32]{Value: &first, Source: senderSource},
	}
	recipient := OrchEffective{TalkLimit: OrchEffectiveField[*uint32]{Value: &second, Source: recipientSource}}
	count := uint64(2)
	evidence := OrchSendingEvidence{AtMs: 10, GrantUntilMs: 11, Count: &count}
	got := ResolveOrchSending(sender, recipient, evidence)
	if got.Route != OrchSendingGranted || !got.NeedsPerson || got.PairLimit == nil || *got.PairLimit != 2 ||
		got.LimitSource != recipientSource {
		t.Fatalf("live grant and tied cap = %+v", got)
	}
	evidence.GrantUntilMs = evidence.AtMs
	got = ResolveOrchSending(sender, recipient, evidence)
	if got.Route != OrchSendingRestricted || got.NeedsPerson {
		t.Fatalf("grant at its deadline = %+v", got)
	}
	sender.Sending.Value = "leads"
	evidence.RecipientIsLead = true
	evidence.SenderIsLead = true
	got = ResolveOrchSending(sender, recipient, evidence)
	if got.Route != OrchSendingAllowed || got.NeedsPerson {
		t.Fatalf("lead exemption = %+v", got)
	}
	evidence.SenderIsLead = false
	evidence.Count = nil
	first = 1
	got = ResolveOrchSending(sender, recipient, evidence)
	if got.Route != OrchSendingAllowed || got.NeedsPerson || got.PairLimit == nil || *got.PairLimit != 1 ||
		got.LimitSource != senderSource {
		t.Fatalf("historical route with sender's smaller limit = %+v", got)
	}
}
