// Arabic user-facing messages for the error codes of 02-Backend (docs/api.md and routes).
// The backend replies in English; the UI is Arabic, so we translate by `error.code`.

const BY_CODE = {
  USER_NOT_FOUND_IN_DB: 'لا يوجد حساب في المنصة مرتبط بهذا المستخدم.',
  UNAUTHENTICATED: 'انتهت الجلسة. سجّل الدخول من جديد.',
  PROJECT_ACCESS_DENIED: 'حسابك غير فعّال أو غير مرتبط بدعوة مقبولة.',
  FORBIDDEN: 'ليس لديك صلاحية لهذه العملية.',
  REGISTRATION_PENDING: 'تم إرسال طلب انضمامك إلى المنظمين، بانتظار الموافقة وتعيين الفريق/الحرم.',
  REGISTRATION_REJECTED: 'نعتذر، تم رفض طلب انضمامك إلى المنصة.',
  REGISTRATION_NOT_FOUND: 'طلب الانضمام غير موجود.',
  REGISTRATION_ALREADY_DECIDED: 'تم البت في هذا الطلب مسبقًا.',
  INVALID_APPROVAL_DATA: 'اختر الدور، والحرم والفريق للمدير والعضو.',
  INVALID_REJECTION_DATA: 'سبب الرفض يجب ألا يتجاوز 1000 حرف.',
  INVALID_REGISTRATION_ID: 'معرّف الطلب غير صالح.',
  TEAM_CAMPUS_MISMATCH: 'الفريق المختار لا يتبع الحرم المختار.',
  CAMPUS_NOT_FOUND: 'الحرم غير موجود.',
  INVALID_JSON: 'تعذّر قراءة البيانات المرسلة.',
  INVALID_USER_DATA: 'بيانات المستخدم غير صالحة.',
  INVALID_TEAM_DATA: 'بيانات الفريق غير صالحة.',
  INVALID_POINT_DATA: 'بيانات النقاط غير صالحة: قيمة صحيحة بين -100 و100 وغير صفر، والنشاط والسبب مطلوبان.',
  INVALID_REVERSAL_DATA: 'سبب العكس إلزامي.',
  INVALID_DELETION_DATA: 'السبب إلزامي (من 1 إلى 1000 حرف).',
  INVALID_STATUS_DATA: 'بيانات الحالة غير صالحة.',
  INVALID_TEAM_STATUS: 'بيانات حالة الفريق غير صالحة.',
  INVALID_MANAGER_DATA: 'بيانات استبدال المدير غير صالحة.',
  INVALID_REGISTRATION_DATA: 'بيانات التسجيل غير صالحة.',
  INVALID_USER_ID: 'معرّف المستخدم غير صالح.',
  INVALID_TEAM_ID: 'معرّف الفريق غير صالح.',
  INVALID_CAMPUS_ID: 'معرّف الحرم غير صالح.',
  INVALID_RANKING_QUERY: 'بيانات الترتيب غير صالحة: اختر النطاق والشهر.',
  INVALID_AUDIT_QUERY: 'فلاتر سجل التدقيق غير صالحة.',
  INVALID_EVALUATION_DATA: 'بيانات التقييم غير صالحة: 4 درجات من 0 إلى 100 واسم وتاريخ صحيح.',
  INVALID_EVALUATION_PERIOD: 'الشهر أو السنة غير صالحين.',
  MANAGER_NOT_FOUND: 'المدير غير موجود.',
  MANAGER_INELIGIBLE: 'لا يمكن تقييم هذا المدير: يجب أن يكون فعّالًا ولديه فريق وحرم.',
  NOT_A_MANAGER: 'هذا المستخدم ليس مديرًا.',
  INVALID_ENTRY_ID: 'معرّف عملية النقاط غير صالح.',
  USER_NOT_FOUND: 'المستخدم غير موجود.',
  TEAM_NOT_FOUND: 'الفريق غير موجود.',
  CAMPUS_NOT_FOUND: 'الحرم غير موجود.',
  RECIPIENT_NOT_FOUND: 'العضو المستلم غير موجود.',
  ENTRY_NOT_FOUND: 'العملية غير موجودة.',
  ROUTE_NOT_FOUND: 'هذه الخدمة غير متوفرة في الخادم بعد.',
  USER_DELETED: 'هذا الحساب محذوف. استرجعه أولًا.',
  USER_NOT_DELETED: 'هذا الحساب غير محذوف.',
  EMAIL_ALREADY_EXISTS: 'يوجد حساب بنفس البريد الإلكتروني.',
  TEAM_ALREADY_EXISTS: 'يوجد فريق بهذا الاسم في هذا الحرم.',
  TEAM_MANAGER_EXISTS: 'لهذا الفريق مدير حالي بالفعل، ولكل فريق مدير واحد فقط. أزل المدير الحالي أولًا.',
  INVALID_TEAM_MANAGER: 'اختر حساب مدير فعّالًا وغير محذوف.',
  OPERATIONAL_TEAM_NEEDS_MANAGER: 'لا يمكن إزالة مدير فريق فعّال. عطّل الفريق أولًا.',
  TEAM_REQUIRED: 'الأعضاء والمدراء يجب أن ينتموا إلى فريق.',
  INVALID_ASSIGNMENT: 'المنظّم لا ينتمي إلى فريق.',
  LAST_ACTIVE_ORGANIZER: 'لا يمكن تعطيل أو حذف أو تخفيض آخر منظّم فعّال.',
  SELF_LOCKOUT: 'لا يمكنك تخفيض دورك أو تعطيل حسابك أو حذفه بنفسك؛ يقوم بذلك منظّم آخر.',
  MANAGER_REPLACEMENT_REQUIRED: 'هذا المدير يدير فريقًا فعّالًا لا يبقى بلا مدير: عطّل ذلك الفريق أو عيّن له مديرًا آخر أولًا.',
  ACTIVE_TEAM_MANAGER_REQUIRED: 'تفعيل الفريق يتطلب مديرًا فعّالًا من نفس الفريق.',
  INVALID_MANAGER: 'الفريق الفعّال يتطلب مديرًا فعّالًا ومرتبطًا بحسابه.',
  MANAGER_CHANGED: 'تغيّر مدير الفريق. أعد تحميل الصفحة وحاول مرة أخرى.',
  INVALID_CURRENT_MANAGER: 'إسناد المدير الحالي غير متّسق. راجع الباك.',
  INVALID_REPLACEMENT: 'اختر عضوًا فعّالًا ومرتبطًا من نفس الفريق ولا يدير فريقًا آخر.',
  RESTORE_TEAM_NOT_FOUND: 'يجب أن يوجد الفريق الأصلي قبل استرجاع الحساب.',
  MANAGER_RESTORE_CONFLICT: 'لا يمكن استرجاع المدير: يجب أن يكون فريقه غير فعّال وبلا مدير.',
  ASSIGNMENT_HISTORY_CONFLICT: 'تعارض في سجل الإسناد. راجع بيانات الحساب.',
  ACCOUNT_BUSY: 'عملية أخرى على الحساب قيد التنفيذ. أعد المحاولة بعد لحظات.',
  INVITATION_BUSY: 'ربط الحساب قيد التنفيذ. أعد المحاولة بعد لحظات.',
  INVITATION_COOLDOWN: 'انتظر دقيقة على الأقل قبل إعادة إرسال الدعوة.',
  EMAIL_VERIFICATION_REQUIRED: 'يجب أن يؤكد المستخدم بريده الجديد في حسابه أولًا.',
  EMAIL_IDENTITY_CONFLICT: 'هذا البريد مرتبط بحساب أو دعوة أخرى.',
  LINK_ACCOUNT_FIRST: 'أكمل ربط الحساب بقبول الدعوة قبل تغيير البريد.',
  EMAIL_CHANGE_NEEDS_REVIEW: 'لم يُحفظ تغيير البريد. راجع الدعوة السابقة قبل إعادة المحاولة.',
  IDENTITY_PROVIDER_UNAVAILABLE: 'خدمة التحقق من الهوية غير متاحة مؤقتًا. أعد المحاولة لاحقًا.',
  CANNOT_REVERSE_REVERSAL: 'لا يمكن عكس عملية عكسية.',
  ALREADY_REVERSED: 'هذه العملية معكوسة مسبقًا.',
  DUPLICATE_POINT_SUBMISSION: 'سُجّلت عملية نقاط مطابقة قبل لحظات؛ لم تُكرَّر.',
  IDEMPOTENCY_KEY_REUSED: 'استُخدم مفتاح الإرسال لعملية مختلفة. أعد المحاولة.',
  INVALID_IDEMPOTENCY_KEY: 'مفتاح الإرسال غير صالح.',
  INVALID_CORRECTION: 'بيانات التصحيح غير صالحة.',
  CORRECTION_REASON_REQUIRED: 'سبب التصحيح إلزامي.',
  MONTH_NOT_CLOSED: 'التصحيح للأشهر السابقة فقط؛ استخدم إضافة النقاط للشهر الحالي.',
  CORRECTION_RECIPIENT_INELIGIBLE: 'يمكن تصحيح نقاط عضو أو مدير غير محذوف فقط.',
  NO_TEAM_IN_MONTH: 'لم يكن هذا الشخص ضمن أي فريق في ذلك الشهر.',
  MONTH_LOCKED: 'هذا الشهر مقفل.',
  INVALID_MONTH: 'الشهر غير صالح.',
  INVALID_CAMPUS: 'الفرع غير صحيح.',
  INVALID_SCORECARD: 'أكمل جميع البنود ضمن الحدود المحددة.',
  INVALID_SCORECARD_REASON: 'سبب التقييم مطلوب (حتى 2000 حرف).',
  SCORECARD_CHANGED: 'تم تعديل التقييم بواسطة مستخدم آخر. أغلق النافذة وافتحها مجددًا.',
  INVALID_ACTIVITY: 'أدخل اسم النشاط وشرحه ونقاطًا من 0 إلى 99.',
  INVALID_AWARD: 'بيانات التكريم غير صالحة.',
  INVALID_AWARD_CANDIDATE: 'اختر عضوًا من متصدري النقاط في المجموعات الأربع.',
  POLICY_NOT_FOUND: 'السياسة غير معروفة.',
  INVALID_POLICY_VALUE: 'قيمة السياسة غير صالحة (الحد الأقصى للنقاط من 1 إلى 100).',
  POLICY_NOT_SUPPORTED: 'هذا الخيار غير مدعوم في بنية البيانات الحالية.',
  POINTS_LIMIT_EXCEEDED: 'تجاوزت الحد الأقصى للنقاط في العملية الواحدة.',
  INVALID_SYSLOG_QUERY: 'فلاتر سجل النظام غير صالحة.',
  MONTH_NOT_ENDED: 'لا يمكن إغلاق الشهر قبل انتهائه.',
  MONTH_ALREADY_PUBLISHED: 'تم إغلاق هذا الشهر مسبقًا.',
  EXISTING_SNAPSHOT_ROWS: 'توجد لقطة محفوظة لهذا الشهر مسبقًا.',
  SNAPSHOT_CONFLICTS: 'تعذّر إغلاق الشهر بسبب تكرار في بيانات اللقطة.',
  CLOSE_IN_PROGRESS: 'توجد عملية أخرى قيد التنفيذ. أعد المحاولة بعد لحظات.',
  SNAPSHOT_NOT_FOUND: 'لا توجد لقطة لهذا الشهر.',
  INVALID_ARCHIVE_MONTH: 'الشهر غير صالح.',
  NOT_SUPPORTED_BY_BACKEND: 'هذه الميزة غير متاحة بعد.',
  INVALID_QUESTION: 'اكتب سؤالك أولًا (حتى 2000 حرف).',
  ASSISTANT_RATE_LIMITED: 'أسئلة كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.',
  ASSISTANT_UNAVAILABLE: 'المساعد غير متاح مؤقتًا. أعد المحاولة لاحقًا.',
  ASSISTANT_TIMEOUT: 'استغرق المساعد وقتًا طويلًا. أعد المحاولة.',
  NO_MANAGED_TEAM: 'لا تدير فريقًا حاليًا، لذلك لا يوجد سجل نقاط لفريق.',
  // Super Admin governance
  SUPER_ADMIN_REQUIRED: 'هذا الإجراء متاح للمشرف العام فقط.',
  SUPER_ADMIN_PROTECTED: 'حساب المشرف العام محمي ولا يمكن تعديله أو تعطيله أو حذفه من المنصة.',
  ORGANIZER_MANAGEMENT_RESTRICTED: 'إدارة حسابات المنظّمين (الإضافة والتعديل والتعطيل والحذف وتغيير الدور) متاحة للمشرف العام فقط.',
  EVALUATION_TARGET_ORGANIZER: 'لا يمكن تقييم المنظّمين أو المشرف العام.',
  EVALUATION_TARGET_INELIGIBLE: 'يمكن تقييم المديرين والأعضاء المنتمين إلى فريق فقط.',
  ORGANIZER_MEMBER_EVAL_DISABLED: 'تقييم المنظّمين مقتصر حاليًا على المديرين فقط. يمكن للمشرف العام السماح بتقييم الأعضاء.',
  CROSS_CAMPUS_EVAL_DISABLED: 'التقييم بين الحرمين غير مفعّل لحرمك. يمكن للمشرف العام تفعيل تفويض مؤقت.',
  ORGANIZER_CAMPUS_REQUIRED: 'لم يُحدَّد حرم لحسابك بعد؛ اطلب من المشرف العام تحديده.',
  INVALID_GOVERNANCE_DATA: 'بيانات إعدادات الحوكمة غير صالحة.',
  OUT_OF_CAMPUS_SCOPE: 'يدير المنظّم الأعضاء والمديرين في حرمه فقط.',
  MANUAL_CREATION_DISABLED: 'إنشاء الحسابات يدويًا غير متاح؛ يسجّل المستخدم ويرسل طلب انضمام ثم يُوافَق عليه.',
  RESTORE_TEAM_MANAGER_EXISTS: 'هذا الفريق لديه مدير معيّن حالياً؛ اختر فريقاً آخر أو أعده كعضو',
  INVALID_RESTORE_DATA: 'اختر الدور والحرم والفريق واكتب سببًا للاستعادة.',
  // Registration workflow
  REGISTRATION_REQUIRED: 'أرسل طلب انضمام لتتمكن من استخدام المنصة.',
  REGISTRATION_OUT_OF_SCOPE: 'هذا الطلب خارج صلاحياتك: يراجع المنظّم طلبات الأعضاء والمديرين في حرمه فقط.',
  CROSS_CAMPUS_APPROVAL_RESTRICTED: 'تعيين الشخص في حرم آخر متاح للمشرف العام فقط.',
  INVALID_REGISTRATION_REQUEST: 'بيانات طلب الانضمام غير صالحة.',
  EMAIL_NOT_VERIFIED: 'أكّد بريدك الإلكتروني في حسابك أولًا ثم أعد إرسال الطلب.',
  ALREADY_REGISTERED: 'لديك حساب في المنصة بالفعل. أعد تحميل الصفحة.',
  EMAIL_ALREADY_REQUESTED: 'يوجد طلب انضمام معلّق بهذا البريد الإلكتروني.',
  DATABASE_UNAVAILABLE: 'قاعدة البيانات غير متاحة حاليًا.',
  INTERNAL_SERVER_ERROR: 'حدث خطأ غير متوقع في الخادم.',
};

const BY_STATUS = {
  400: 'البيانات المدخلة غير صالحة.',
  401: 'انتهت الجلسة. سجّل الدخول من جديد.',
  403: 'ليس لديك صلاحية لهذه العملية.',
  404: 'العنصر غير موجود.',
  409: 'تعارض مع إحدى قواعد العمل.',
  429: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  503: 'الخدمة غير متاحة مؤقتًا. أعد المحاولة لاحقًا.',
};

const GENERIC = 'حدث خطأ غير متوقع. حاول مرة أخرى.';

/**
 * Turns a failed response body into { message (Arabic), details }.
 * Supports the backend shape { error: { code, message } } and the older
 * contract shape { message, details }.
 */
// Why the assistant is unavailable (POST /api/assistant passes a known `reason` with ASSISTANT_UNAVAILABLE).
export const ASSISTANT_REASON_AR = {
  AI_QUOTA_EXCEEDED: 'وصل المساعد إلى حد الاستخدام اليومي لخدمة الذكاء الاصطناعي. ما زال يجيب فورًا عن طريقة استخدام المنصة وعن نقاطك ونقاط فريقك هذا الشهر؛ أعد الأسئلة الأخرى لاحقًا.',
  AI_UNAVAILABLE: 'خدمة الذكاء الاصطناعي مشغولة حاليًا. أعد المحاولة بعد قليل.',
  AI_MODEL_UNAVAILABLE: 'نموذج الذكاء الاصطناعي غير متاح حاليًا. أبلغ المنظّم.',
  AI_KEY_INVALID: 'إعداد خدمة الذكاء الاصطناعي غير صحيح. أبلغ المنظّم.',
  AI_KEY_MISSING: 'خدمة الذكاء الاصطناعي غير مُعدّة بعد. أبلغ المنظّم.',
  CHATBOT_NOT_CONFIGURED: 'المساعد غير مُعدّ بعد. أبلغ المنظّم.',
  BACKEND_UNAVAILABLE: 'تعذّر الوصول إلى بيانات المنصة مؤقتًا. أعد المحاولة بعد قليل.',
};

export function translateServerError(status, body) {
  const err = body && typeof body === 'object' ? body.error : null;
  if (err && typeof err === 'object') {
    const code = typeof err.code === 'string' ? err.code : undefined;
    const reason = typeof err.reason === 'string' ? err.reason : undefined;
    const byReason = code === 'ASSISTANT_UNAVAILABLE' && reason ? ASSISTANT_REASON_AR[reason] : undefined;
    return {
      message: byReason || (code && BY_CODE[code]) || BY_STATUS[status] || GENERIC,
      details: { code, reason, serverMessage: err.message },
    };
  }
  if (body && typeof body === 'object' && typeof body.message === 'string') {
    return { message: body.message, details: body.details };
  }
  return { message: BY_STATUS[status] || GENERIC, details: undefined };
}
