"""Resolve a source_domain (or a user's keyword) to a canonical brand.

A naive substring match misses short-link domains — pin.it ⊄ "pinterest", youtu.be ⊄
"youtube", x.com ⊄ "twitter" — which is exactly how those links are stored. Both the Ask
planner ("find my Pinterest notes") and the search bar ("pinterest") rely on this to map a
brand the user names onto the notes actually saved from it. Mirrors the frontend SOURCE_ALIASES.
"""

# domain fragment → canonical brand
_SOURCE_ALIASES = {
    "pin.it": "pinterest", "pinterest": "pinterest",
    "youtu.be": "youtube", "youtube": "youtube",
    "amzn": "amazon", "amazon": "amazon",
    "x.com": "twitter", "twitter": "twitter",
    "fb.com": "facebook", "fb.watch": "facebook", "facebook": "facebook",
    "instagr.am": "instagram", "instagram": "instagram",
    "redd.it": "reddit", "reddit": "reddit",
    "tiktok": "tiktok", "vm.tiktok": "tiktok",
    "substack": "substack",
}


def canonical_source(value: str) -> str:
    """Exact short-domain hits win first (pin.it, youtu.be, x.com), then any alias substring,
    then the registrable label as a fallback ("open.substack.com" → "substack")."""
    v = value.lower().strip().replace("www.", "")
    if v in _SOURCE_ALIASES:
        return _SOURCE_ALIASES[v]
    for key, canon in _SOURCE_ALIASES.items():
        if key in v:
            return canon
    parts = [p for p in v.split(".") if p]
    return parts[-2] if len(parts) >= 2 else (parts[0] if parts else v)


def source_matches(domain: str, keyword: str) -> bool:
    """True if a note's source_domain belongs to the brand the user named — by canonical
    brand, with a raw substring check as a fallback for domains the alias map doesn't know."""
    domain = (domain or "").lower()
    keyword = keyword.lower().strip()
    if not keyword:
        return False
    return keyword in domain or canonical_source(domain) == canonical_source(keyword)
