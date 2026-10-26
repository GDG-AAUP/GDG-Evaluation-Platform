// Arabic user-facing messages for the error codes of 02-Backend (docs/api.md and routes).
// The backend replies in English; the UI is Arabic, so we translate by `error.code`.

const BY_CODE = {
  UNAUTHENTICATED: 'انتهت الجلسة. سجّل الدخول من جديد.',
  PROJECT_ACCESS_DENIED: 'حسابك غير فعّال أو غير مرتبط بدعوة مقبولة.',
  FORBIDDEN: 'ليس لديك صلاحية لهذه العملية.',
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
  TEAM_MANAGER_EXISTS: 'لهذا الفريق مدير بالفعل. استخدم استبدال المدير.',
  TEAM_REQUIRED: 'الأعضاء والمدراء يجب أن ينتموا إلى فريق.',
  INVALID_ASSIGNMENT: 'المنظّم لا ينتمي إلى فريق.',
  LAST_ACTIVE_ORGANIZER: 'لا يمكن تعطيل أو حذف أو تخفيض آخر منظّم فعّال.',
  MANAGER_REPLACEMENT_REQUIRED: 'عيّن بديلًا لمدير الفريق قبل هذه العملية.',
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
export function translateServerError(status, body) {
  const err = body && typeof body === 'object' ? body.error : null;
  if (err && typeof err === 'object') {
    const code = typeof err.code === 'string' ? err.code : undefined;
    return {
      message: (code && BY_CODE[code]) || BY_STATUS[status] || GENERIC,
      details: { code, serverMessage: err.message },
    };
  }
  if (body && typeof body === 'object' && typeof body.message === 'string') {
    return { message: body.message, details: body.details };
  }
  return { message: BY_STATUS[status] || GENERIC, details: undefined };
}
