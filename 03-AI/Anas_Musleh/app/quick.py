"""Instant answers that need no AI call.

Platform "how do I ..." questions and the two most common live figures (my points / my team's points
this month) are answered here in milliseconds, from fixed text or one read-only backend call. They keep
working when every Gemini model is out of quota or overloaded. Anything more specific (another month,
a person's name, a comparison, a year) returns None and goes to the model as before.
"""
from __future__ import annotations

import logging
import re

from .errors import BackendError
from .prompts import ARABIC_MONTHS
from .tools import ToolExecutor

logger = logging.getLogger("gdg.chatbot")

_MARKS = re.compile(r"[ً-ْـ]")          # tashkeel and tatweel


def normalize(text: str) -> str:
    t = _MARKS.sub("", text or "").strip().lower()
    t = re.sub("[أإآ]", "ا", t).replace("ة", "ه").replace("ى", "ي")
    return " ".join(t.replace("؟", " ").replace("?", " ").split())


def _has(t: str, *words: str) -> bool:
    return any(w in t for w in words)


_HOW = ("كيف", "طريقه", "شو الطريقه", "خطوات", "how ")
# Anything that names another period, a number or a comparison needs the model.
_OTHER_PERIOD = ("الماضي", "السابق", "الفائت", "قبل", "امس", "سنه", "عام", "كانون", "شباط", "اذار", "نيسان",
                 "ايار", "حزيران", "تموز", "ايلول", "تشرين", "last", "previous", "year", "مقارنه", "قارن")

ADD_POINTS = {
    "manager": (
        "لإضافة نقاط لعضو في فريقك:\n"
        "1. افتح «إضافة نقاط» من القائمة.\n"
        "2. اختر العضو من أعضاء فريقك واضغط «إضافة نقاط».\n"
        "3. أدخل النقاط: عدد صحيح من -100 إلى 100 بدون صفر (السالب للخصم)، ثم اسم النشاط والسبب (إلزاميان).\n"
        "4. اضغط «إضافة». يظهر ملخص العملية وسجل نقاط فريقك في الصفحة نفسها، وتُسجَّل العملية في سجل التدقيق.\n"
        "لا يمكنك إضافة نقاط لنفسك. وأنا مساعد للقراءة فقط، فلا أضيف نقاطًا بنفسي."
    ),
    "organizer": (
        "لإضافة نقاط:\n"
        "1. افتح «إضافة نقاط» من القائمة.\n"
        "2. اختر العضو أو المدير واضغط «إضافة نقاط».\n"
        "3. أدخل النقاط: عدد صحيح من -100 إلى 100 بدون صفر (السالب للخصم)، ثم اسم النشاط والسبب (إلزاميان).\n"
        "4. اضغط «إضافة». يظهر ملخص العملية وسجل النقاط التي أضفتها في الصفحة نفسها، وتُسجَّل في سجل التدقيق.\n"
        "لا يمكنك إضافة نقاط لنفسك. وأنا مساعد للقراءة فقط، فلا أضيف نقاطًا بنفسي."
    ),
    "member": (
        "إضافة النقاط من صلاحية مدير فريقك أو المنظّم فقط، فتواصل مع مدير فريقك. "
        "وأنا مساعد للقراءة فقط، فلا أضيف نقاطًا."
    ),
}

RANKING = (
    "يُحسب الترتيب شهريًا من مجموع النقاط المسجّلة خلال الشهر نفسه فقط (ليس مجموعًا تراكميًا):\n"
    "• لكل فريق ترتيبه، ولكل حرم (جنين ورام الله) ترتيب مستقل، ولا يوجد ترتيب يدمج الحرمين.\n"
    "• يظهر مدير الفريق في الترتيب مع أعضاء فريقه.\n"
    "• التعادل: من لهم نفس عدد النقاط يأخذون نفس المرتبة، والمرتبة التالية تليها مباشرة (1، 1، 2).\n"
    "• عكس عملية أو تصحيح شهر مغلق يغيّر مجموع شهر العملية الأصلية، ويُعاد احتساب ترتيب ذلك الشهر.\n"
    "• عند إغلاق الشهر يُحفظ ترتيبه، ويبدأ الشهر التالي من الصفر."
)

CORRECTION = {
    "manager": (
        "لتصحيح نقاط شهر مغلق لأحد أعضاء فريقك: افتح «تصحيح الأشهر المغلقة» من القائمة، ثم «تصحيح»، "
        "واختر الشهر والعضو والنقاط (من -100 إلى 100 بدون صفر) والسبب (إلزامي). تُسجَّل عملية منفصلة داخل ذلك الشهر "
        "ويُعاد احتساب ترتيبه، وتُحفظ القيم قبل التعديل وبعده في سجل التدقيق."
    ),
    "organizer": (
        "لتصحيح نقاط شهر مغلق: افتح «الأرشيف الشهري»، ثم «تصحيح»، واختر الشهر والشخص والنقاط "
        "(من -100 إلى 100 بدون صفر) والسبب (إلزامي). تُسجَّل عملية منفصلة داخل ذلك الشهر ويُعاد احتساب ترتيب "
        "الفريق والحرم، وتُحفظ القيم قبل التعديل وبعده في سجل التدقيق."
    ),
    "member": "تصحيح نقاط الأشهر المغلقة من صلاحية مدير فريقك أو المنظّم فقط.",
}


def _month_label(executor: ToolExecutor) -> str:
    return f"{ARABIC_MONTHS[executor.today.month]} {executor.today.year}"


def _team_points(executor: ToolExecutor) -> str | None:
    me = executor.me()
    if not me.get("teamId"):
        return None                                   # an organizer has no team: let the model ask which one
    team = executor._team(None, None)
    m, y = executor.today.month, executor.today.year
    board = executor.client.leaderboard(executor.token, "team", team["campusId"], team["id"], m, y, None)
    period = _month_label(executor)
    entries = board.get("entries") or []
    if not board.get("hasData") or not entries:
        return f"لا توجد نقاط مسجّلة لفريق {team['name']} في {period} حتى الآن."
    total = board.get("totalPoints")
    if total is None:
        total = sum(e["totalPoints"] for e in entries)
    top = [e for e in entries if e["rank"] == 1]
    leaders = "، ".join(e["name"] for e in top)
    lead = f"الأعلى: {leaders} ({top[0]['totalPoints']} نقطة)" + (" بالتعادل" if len(top) > 1 else "")
    people = board.get("participants") or len(entries)
    return f"مجموع نقاط فريق {team['name']}: {total} نقطة في {period} ({people} مشاركًا). {lead}."


def _my_points(executor: ToolExecutor) -> str:
    m, y = executor.today.month, executor.today.year
    summary = executor.client.my_points_summary(executor.token, m, y)
    total, count = summary.get("totalPoints", 0), summary.get("entriesCount", 0)
    if not count:
        return f"لا توجد لك نقاط مسجّلة في {_month_label(executor)} حتى الآن."
    return f"لديك {total} نقطة في {_month_label(executor)} ({count} عملية)."


def quick_answer(question: str, executor: ToolExecutor) -> str | None:
    """An instant answer, or None when the question needs the model."""
    t = normalize(question)
    if not t or len(t) > 160:
        return None
    try:
        role = (executor.me().get("role") or "member").lower()
        role = role if role in ADD_POINTS else "member"
        how = _has(t, *_HOW)
        points_word = _has(t, "نقاط", "نقطه", "point")
        if how and points_word and _has(t, "اضيف", "اضافه", "امنح", "اعطي", "add"):
            return ADD_POINTS[role]
        if _has(t, "كيف", "how", "طريقه") and _has(t, "ترتيب", "rank") and _has(t, "يحسب", "تحسب", "حساب", "يتم", "calculat"):
            return RANKING
        if how and _has(t, "تصحيح", "اصحح", "correct") and _has(t, "شهر", "month"):
            return CORRECTION[role]

        live = not how and not re.search(r"\d", t) and not _has(t, *_OTHER_PERIOD)
        if live and points_word and _has(t, "فريقي", "فريقنا", "my team"):
            return _team_points(executor)
        if live and not _has(t, "فريق", "team") and (_has(t, "نقاطي", "my points")
                                                      or (_has(t, "كم") and points_word
                                                          and _has(t, "عندي", "لدي", "حصلت", "معي", "جمعت"))):
            return _my_points(executor)
    except (BackendError, KeyError, StopIteration) as error:
        # Any doubt: the model (with its own error handling) takes over.
        logger.info("Quick answer skipped: %s", getattr(error, "code", type(error).__name__))
    return None
