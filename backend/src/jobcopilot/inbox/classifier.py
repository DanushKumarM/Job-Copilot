"""Rule-based email classification (FR24). Deterministic and explainable; returns the phrases it matched.

Order matters: a rejection usually also says "thank you for applying", and an interview invite after an
assessment mentions both, so the more decisive class wins and a contested result gets lower confidence.
"""

import re
from dataclasses import dataclass

from jobcopilot.enums import MessageClass
from jobcopilot.inbox.message import EmailMessage

C = MessageClass

_PATTERNS: list[tuple[MessageClass, float, list[str]]] = [
    (
        C.OFFER,
        0.9,
        [
            r"pleased to (?:extend|offer)",
            r"offer letter",
            r"extend (?:you )?an offer",
            r"(?:job|employment) offer",
        ],
    ),
    (
        C.REJECTION,
        0.95,
        [
            r"not (?:to )?(?:be )?mov(?:e|ing) forward",
            r"decided to (?:move|proceed|go) (?:forward )?with other",
            r"(?:will|have decided to) not (?:be )?(?:proceed|progress|mov)",
            r"regret to inform",
            r"unable to (?:move|proceed|offer)",
            r"position has (?:been|now been) filled",
            r"not (?:been )?selected",
            r"pursue other candidates",
            r"unfortunately,? (?:we|after|the|your)",
        ],
    ),
    (
        C.ASSESSMENT,
        0.9,
        [
            r"coding (?:challenge|assessment|test|round)",
            r"online (?:assessment|test)",
            r"take[- ]home",
            r"hackerrank|codility|hackerearth|codesignal|testgorilla|mettl",
            r"technical assessment",
        ],
    ),
    (
        C.INTERVIEW,
        0.85,
        [
            r"(?:schedule|book|invite you (?:to|for))(?: an?| your)? (?:\w+ )?interview",
            r"interview (?:invitation|invite|schedule|slot)",
            r"your availability",
            r"next round",
            r"(?:phone|video|technical|hr) (?:screen|interview|call)",
            r"calendly\.com|goodtime\.io",
        ],
    ),
    (
        C.CONFIRMATION,
        0.95,
        [
            r"thanks? (?:you )?for (?:applying|your application|your interest)",
            r"(?:we(?:'ve| have)|has been) received(?: your application)?",
            r"application (?:has been |was )?(?:received|submitted|sent)",
            r"your application (?:to|for) .{1,80} (?:was|has been) (?:sent|submitted|received)",
            r"applied successfully|successfully applied",
        ],
    ),
    (
        C.JOB_ALERT,
        0.9,
        [
            r"job alert",
            r"jobs? (?:for you|you may be interested in|matching your)",
            r"new jobs? (?:for|matching|similar)",
            r"recommended jobs?",
        ],
    ),
]

_COMPILED = [(cls, conf, [re.compile(p, re.IGNORECASE) for p in pats]) for cls, conf, pats in _PATTERNS]

# Classes that may appear together naturally without lowering confidence (a rejection that thanks you).
_COMPATIBLE = {
    C.REJECTION: {C.CONFIRMATION},
    C.OFFER: {C.CONFIRMATION, C.INTERVIEW},
    C.ASSESSMENT: {C.CONFIRMATION, C.INTERVIEW},
    C.INTERVIEW: {C.CONFIRMATION},
}


@dataclass(frozen=True)
class Classification:
    label: MessageClass
    confidence: float
    signals: tuple[str, ...]


def classify(message: EmailMessage) -> Classification:
    text = f"{message.subject}\n{message.body[:20_000]}"
    hits: list[tuple[MessageClass, float, list[str]]] = []
    for cls, confidence, patterns in _COMPILED:
        matched = [m.group(0) for p in patterns if (m := p.search(text))]
        if matched:
            hits.append((cls, confidence, matched))
    if not hits:
        return Classification(C.OTHER, 0.5, ())

    label, confidence, signals = hits[0]
    conflicting = [cls for cls, _, _ in hits[1:] if cls not in _COMPATIBLE.get(label, set())]
    if conflicting:
        confidence *= 0.6
    # A single weak phrase found only in the body is less convincing than one in the subject.
    if len(signals) == 1 and signals[0].lower() not in message.subject.lower():
        confidence *= 0.9
    all_signals = tuple(s for _, _, matched in hits for s in matched)
    return Classification(label, round(confidence, 3), all_signals)
