// Arabic feedback for the email sent after approving or rejecting a join request (pure, tested).
// The decision is already saved whatever happens to the email; only the wording changes.

const REASON_AR = {
  EAUTH: 'رفض خادم البريد بيانات الدخول (SMTP_USER / SMTP_PASS). لِـGmail استخدم كلمة مرور تطبيق من 16 حرفًا.',
  ECONNECTION: 'تعذّر الاتصال بخادم البريد (SMTP_HOST / SMTP_PORT).',
  ETIMEDOUT: 'لم يستجب خادم البريد في الوقت المحدد.',
  ESOCKET: 'فشل اتصال TLS بخادم البريد (تحقق من SMTP_PORT: 465 أو 587).',
  EENVELOPE: 'رفض خادم البريد عنوان المرسل أو المستلم (FROM_EMAIL).',
  EDNS: 'تعذّر العثور على خادم البريد (SMTP_HOST).',
};

/**
 * kind: 'approve' | 'reject'; emailStatus: 'sent' | 'skipped' | 'failed'; emailError: { code } | null.
 * Returns { tone: 'ok' | 'warn', message }.
 */
export function emailOutcomeMessage(kind, emailStatus, emailError) {
  const done = kind === 'reject' ? 'تم رفض الطلب' : 'تمت الموافقة';
  if (emailStatus === 'sent') {
    return { tone: 'ok', message: kind === 'reject' ? 'تم رفض الطلب وإرسال الإيميل بنجاح' : 'تمت الموافقة وإرسال الإيميل بنجاح' };
  }
  if (emailStatus === 'skipped') {
    return { tone: 'warn', message: `${done}، لكن لم يُرسل الإيميل لعدم ضبط إعدادات SMTP` };
  }
  const reason = (emailError && REASON_AR[emailError.code]) || 'تعذّر إرسال الإيميل.';
  return { tone: 'warn', message: `${done}، لكن لم يُرسل الإيميل: ${reason}` };
}
