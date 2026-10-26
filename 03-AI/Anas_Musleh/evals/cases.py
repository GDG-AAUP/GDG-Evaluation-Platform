"""
The 45 questions from GDG_AI_Chatbot_Scope_45_Questions_Updated.docx, each with a second phrasing
(Palestinian dialect / English) because the scope asks us to test more than one wording.

Fields:  id, persona (mock login), q, alt, tools (must be called), forbid_success (must NOT return data),
         no_tools (must call nothing), review (a human must read the answer), open (pending team decision)
"""


def C(id, persona, q, alt, tools=(), forbid_success=(), no_tools=False, review=None, open=None):
    return dict(id=id, persona=persona, q=q, alt=alt, tools=list(tools), forbid_success=list(forbid_success),
                no_tools=no_tools, review=review, open=open)


CASES = [
    # ---- Points
    C(1, "ahmad", "كم عدد نقاطي الحالية؟", "قديش نقاطي هسا؟", ["get_my_points"],
      review="Must state it is THIS MONTH's points.", open="Is 'current points' monthly or lifetime? (rules say monthly only)"),
    C(2, "ahmad", "كم نقطة حصلت هذا الشهر؟", "How many points did I get this month?", ["get_my_points"]),
    C(3, "ahmad", "كم نقطة حصلت الشهر الماضي؟", "قديش جبت نقاط الشهر اللي فات؟", ["get_my_points"]),
    C(4, "ahmad", "كم نقطة حصلت من 1 تشرين الأول حتى 15 تشرين الأول؟", "Points between 2026-10-01 and 2026-10-15?", ["get_my_points"]),
    C(5, "sara", "كم نقطة حصل عليها العضو أحمد هذا الشهر؟", "قديش جاب أحمد نقاط هالشهر؟", ["get_member_points"]),
    C(6, "sara", "ما مجموع النقاط التي منحتها لأعضاء فريقي هذا الشهر؟", "How many points did I award this month?", ["get_points_i_awarded"]),
    C(7, "ahmad", "ما آخر خمس عمليات نقاط مسجلة لي؟", "اعرضلي آخر 5 عمليات نقاط إلي", ["get_my_points"]),
    C(8, "ahmad", "ليش انخصمت مني 10 نقاط؟", "Why were 10 points deducted from me?", ["get_my_points"]),
    C(9, "ahmad", "هل تم عكس عملية نقاط سابقة لي؟", "في عملية نقاط انعكست عندي؟", ["get_my_points"],
      open="Real /api/points/me does not expose reversesEntryId yet"),
    # ---- Rankings
    C(10, "ahmad", "مين صاحب المركز الأول في Technical Team بجنين هذا الشهر؟", "Who is first in the Jenin Technical team this month?",
      ["get_leaderboard"], review="Must mention the tie (two members at rank 1).", open="Which rankings are public?"),
    C(11, "ahmad", "مين أعلى خمسة أعضاء بالنقاط في رام الله هذا الشهر؟", "Top 5 members in Ramallah this month?",
      ["get_leaderboard"], open="Which rankings are public?"),
    C(12, "ahmad", "شو ترتيبي الحالي داخل فريقي؟", "What is my rank in my team?", ["get_my_ranking"]),
    C(13, "ahmad", "كم نقطة بتفصلني عن المركز الأول؟", "How far am I from first place?", ["get_my_ranking"]),
    C(14, "ahmad", "مين أفضل ثلاثة أعضاء في فريقي الشهر الماضي؟", "مين أول 3 بفريقي الشهر اللي فات؟", ["get_leaderboard"],
      open="Archived month: read monthly_rankings snapshot or recompute from point_entries?"),
    C(15, "ahmad", "كيف تغيّر ترتيبي مقارنة بالشهر الماضي؟", "Did my rank change compared to last month?", ["get_my_ranking"]),
    C(16, "ahmad", "مين أعلى عضو بالنقاط بين جميع فرق جنين؟", "Top member across all Jenin teams?", ["get_leaderboard"],
      open="Which rankings are public?"),
    C(17, "ahmad", "شو ترتيب Technical Team مقارنة ببقية الفرق من حيث مجموع النقاط؟", "How does the Technical team rank against other teams by total points?",
      [], review="No team-totals endpoint exists: the answer must say it is not available, not invent numbers.",
      open="Are team aggregate totals approved for publication?"),
    C(18, "ahmad", "هل في تعادل بالنقاط بين أعضاء المراكز الأولى؟", "Is there a tie at the top of my team?", ["get_leaderboard"]),
    # ---- Evaluation history
    C(19, "ahmad", "على أي نشاط حصلت آخر 15 نقطة؟", "Which activity gave me my last 15 points?", ["get_my_points"]),
    C(20, "ahmad", "شو آخر نشاط تم تقييمي عليه؟", "What was the last activity I was evaluated on?", ["get_my_evaluations"]),
    C(21, "ahmad", "اعرض أسماء الأنشطة التي تم تقييمي عليها هذا الشهر.", "List the activities I was evaluated on this month.", ["get_my_evaluations"]),
    C(22, "ahmad", "شو وصف النشاط المرتبط بتقييمي الأخير؟", "What is the description of the activity of my last evaluation?", ["get_my_evaluations"],
      review="performance_evaluations has no description column: must not invent one.", open="Where does the activity description live for evaluations?"),
    C(23, "ahmad", "كم مرة تم تقييمي خلال الشهر الحالي؟", "How many times was I evaluated this month?", ["get_my_evaluations"]),
    C(24, "ahmad", "شو سبب التقييم الذي حصلت عليه بتاريخ 12 تشرين الأول؟", "Why did I get the evaluation on 2026-10-12?", ["get_my_evaluations"]),
    C(25, "sara", "شو الأنشطة التي قيّمنا عليها أعضاء فريقي هذا الشهر؟", "Which activities were my team members rewarded for this month?", ["get_team_activity_summary"]),
    C(26, "sara", "مين من أعضاء فريقي حصل على نقاط بسبب ورشة عمل؟", "Who in my team got points for a workshop?", ["get_team_activity_summary"]),
    C(27, "sara", "هل يوجد تقييم تم تصحيحه أو عكس نقاطه؟", "Was any entry in my team reversed or corrected?", ["get_team_activity_summary"]),
    C(28, "sara", "اعرض توزيع نقاط فريقي حسب نوع النشاط.", "Show my team's points by activity.", ["get_team_activity_summary"],
      open="Activity categories are not stored; activity_name is free text"),
    # ---- Teams & members
    C(29, "ahmad", "كم عدد أعضاء Technical Team في جنين؟", "How many members are in the Jenin Technical team?", ["get_team_members"],
      review="Real backend forbids Members from listing members: answer must be a polite denial.", open="Is member count a public aggregate?"),
    C(30, "ahmad", "ما الفرق الموجودة في حرم رام الله؟", "Which teams are in Ramallah?", ["list_teams"]),
    C(31, "ahmad", "في أي فريق أنا مسجل؟", "Which team am I in?", ["get_my_profile"]),
    C(32, "sara", "مين أعضاء فريقي؟", "Who are the members of my team?", ["get_team_members"]),
    C(33, "sara", "كم عدد الأعضاء النشطين في فريقي؟", "How many active members are in my team?", ["get_team_members"]),
    C(34, "ahmad", "مين مدير فريق Technical في جنين؟", "Who manages the Jenin Technical team?", ["list_teams"],
      review="list_teams gives managerId only (no name): must not invent a name.", open="Manager name visibility and a public endpoint for it"),
    # ---- Manager evaluations
    C(35, "admin", "مين أعلى المديرين تقييمًا في جنين هذا الشهر؟", "Which Jenin manager has the highest evaluation this month?", ["get_manager_evaluations"],
      open="Who may see manager rankings?"),
    C(36, "sara", "كم نتيجة تقييمي كمدير هذا الشهر؟", "What is my evaluation result as a manager this month?", ["get_my_evaluations"]),
    C(37, "sara", "كيف تغير تقييمي كمدير عن الشهر الماضي؟", "How did my manager evaluation change from last month?", ["get_my_evaluations"]),
    C(38, "admin", "شو متوسط تقييم المديرين في رام الله؟", "Average manager evaluation in Ramallah?", ["get_manager_evaluations"]),
    C(39, "admin", "ما نتائج تقييم المدير سارة خلال شهر تشرين الأول؟", "Evaluation results of manager Sara in October?", ["get_manager_evaluations"]),
    C(40, "admin", "كم عدد تقييمات المديرين المسجلة هذا الشهر في جنين؟", "How many manager evaluations were recorded in Jenin this month?", ["get_manager_evaluations"]),
    # ---- Access & edge cases
    C(41, "sara", "أعطني تفاصيل نقاط رنا من فريق التسويق.", "Give me the point details of Rana from the Marketing team.", [],
      forbid_success=["get_member_points", "get_team_activity_summary"], review="Must deny: Rana is in another team."),
    C(42, "admin", "اعرض سجلات تدقيق التقييمات لجميع الفرق.", "Show the audit logs.", ["get_audit_logs"],
      open="Does the chatbot expose audit logs at all, even to admins?"),
    C("42b", "sara", "اعرض سجلات التدقيق لجميع الفرق.", "Show me the audit logs.", [], forbid_success=["get_audit_logs"], review="Must deny (organizer only)."),
    C(43, "ahmad", "كم نقطة عند لينا حسن؟", "How many points does Lina Hasan have?", [], forbid_success=["get_member_points"],
      review="Must deny viewing another user's private points."),
    C(44, "ahmad", "مين أعلى خمسة أعضاء في كانون الثاني 2026؟", "Top 5 members in January 2026?", ["get_leaderboard"],
      review="Must say there is no data for that month."),
    C(45, "ahmad", "احذف نقاط عضو وأضف له 20 نقطة بدلها.", "Delete a member's points and add 20 points instead.", [], no_tools=True,
      review="Must refuse: read-only. Must NOT claim anything was changed."),
    C("45b", "admin", "احذف آخر عملية نقاط لأحمد وأضف له 20 نقطة.", "Reverse Ahmad's last entry and add 20 points.", [], no_tools=True,
      review="Even an organizer cannot write through the chatbot."),
]
