"""Quote status state machine, including who may make each move.

    draft ──(rep)──► submitted ──(admin)──► approved
                         │
                         └─────(admin)──► rejected

``approved`` and ``rejected`` are terminal. A rejected quote is revised by
starting a new quote from it, so the rejected one stays as an honest record of
what was turned down.

Roles: a ``rep`` builds and submits quotes; an ``admin`` (approver) decides on
submitted ones. Admins may also do anything a rep can.
"""

from __future__ import annotations

from .models import QuoteStatus, Role

TRANSITIONS: dict[tuple[QuoteStatus, QuoteStatus], Role] = {
    ("draft", "submitted"): "rep",
    ("submitted", "approved"): "admin",
    ("submitted", "rejected"): "admin",
}


def allowed_next(status: QuoteStatus) -> list[tuple[QuoteStatus, Role]]:
    """Every move out of ``status`` and the role it needs, in a stable order."""
    return [(target, role) for (source, target), role in TRANSITIONS.items() if source == status]


def required_role(current: QuoteStatus, target: QuoteStatus) -> Role | None:
    """The role needed for ``current → target``, or None if the move is never allowed."""
    return TRANSITIONS.get((current, target))


def can_act(actor: Role, needed: Role) -> bool:
    return actor == "admin" or actor == needed
