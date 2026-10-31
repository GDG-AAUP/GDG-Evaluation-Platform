"""Language hint for the model.

Why: the system prompt already says "reply in the language the user wrote in", yet in the eval run of 2026-10-28
13 of 41 English questions were answered in Arabic, and ALL 7 English refusals/denials (rule F-16b did not change that).
A short note attached to the user's own message is read much more reliably than a rule in the system prompt.
Only English gets a note: no Arabic question was ever answered in English.
"""
import re

_AR = re.compile(r"[\u0600-\u06FF]")
_LAT = re.compile(r"[A-Za-z]")

ENGLISH_NOTE = ("\n\n(Note from the system: the user wrote in English. Answer in English only, including any refusal or denial. "
                "Arabic names stay as they are.)")


def language_hint(text: str) -> str:
    """'' for Arabic or mixed text; the English note for a question with no Arabic letters and at least 5 Latin ones."""
    if not _AR.search(text) and len(_LAT.findall(text)) >= 5:
        return ENGLISH_NOTE
    return ""
