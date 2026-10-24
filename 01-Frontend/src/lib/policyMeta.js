// Labels / control types of the policy flags (Policies page + audit messages).
export const POLICY_FIELDS = [
  { key: 'managerCanEditOrMoveMembers', type: 'switch', label: 'السماح للمدير بتعديل الأعضاء ونقلهم', hint: 'إذا كان معطّلًا يستطيع المدير إضافة عضو فقط.' },
  { key: 'membersInMultipleTeams', type: 'switch', label: 'عضوية متعددة الفرق', hint: 'إذا كان معطّلًا ينتمي العضو إلى فريق واحد.' },
  { key: 'globalLeaderboardEnabled', type: 'switch', label: 'لوحة الترتيب العامة', hint: 'تجمع الحرمين في تبويب «الترتيب العام».' },
  { key: 'maxPointsPerOperation', type: 'number', label: 'الحد الأقصى للنقاط في العملية', hint: 'يُطبَّق على كل إضافة نقاط وتصحيح متأخر.' },
  { key: 'multipleManagersPerTeam', type: 'switch', label: 'أكثر من مدير للفريق الواحد', hint: 'يتحكم في اختيار المديرين عند تعديل فريق.' },
];
