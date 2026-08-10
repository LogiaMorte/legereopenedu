/** Profil istemci etiketleri — TR/EN sayfalar config JSON'a basar. */

export const profileLabelsTr = {
  locale: 'tr-TR',
  homePath: '/',
  verifyPath: '/verify',
  strings: {
    memberFallback: 'Üye',
    verifyLabel: 'Doğrula',
    saving: 'Kaydediliyor...',
    privacySaved: 'Gizlilik ayarı kaydedildi',
    privacyError: 'Ayar kaydedilemedi — eski haline alındı',
    profileSaved: 'Profil güncellendi',
    schoolEmailInUse: 'Bu okul e-postası başka bir hesap tarafından kullanılıyor.',
    schoolEmailInvalid: 'Geçerli bir okul e-posta adresi girin.',
    saveGenericError: 'Bir hata oluştu. Lütfen tekrar deneyin.',
    connectionError: 'Bağlantı hatası.',
    linkedinVerifiedTitle: 'LinkedIn tarafından doğrulanmış',
  },
  badgeMeta: {
    'first-workshop': { icon: '🎓', name: 'İlk Adım', desc: 'İlk atölyeyi tamamladı' },
    'three-workshops': { icon: '⭐', name: 'Araştırmacı', desc: 'Üç atölye tamamladı' },
    'five-workshops': { icon: '🏆', name: 'Uzman Araştırmacı', desc: 'Beş atölye tamamladı' },
    'multi-discipline': {
      icon: '🔗',
      name: 'Disiplinlerarası',
      desc: '3+ farklı disiplinden atölyelere katıldı',
    },
    pioneer: { icon: '🚀', name: 'Öncü', desc: 'Kurucu dönem katılımcısı' },
    mentor: { icon: '🧭', name: 'Mentor', desc: 'Mentorluk katkısında bulundu' },
    contributor: { icon: '✍️', name: 'Katkıcı', desc: 'Yayın sürecine aktif katkı' },
    scholar: { icon: '📖', name: 'Akademisyen', desc: 'Akademik yayın üretti' },
  },
  certTypes: {
    participation: 'Katılım Sertifikası',
    achievement: 'Başarı Sertifikası',
    contribution: 'Katkı Sertifikası',
  },
  statusMap: {
    completed: { label: 'Tamamlandı', cls: 'badge-open' },
    accepted: { label: 'Kabul Edildi', cls: 'badge-upcoming' },
    pending: { label: 'Beklemede', cls: 'badge-discipline' },
    rejected: { label: 'Reddedildi', cls: 'badge-closed' },
  },
  interestLabels: {
    projects: 'Projelerde Yer Almak',
    workshops: 'Atölye İçeriği Üretmek',
    seminars: 'Seminer / Kolokyum Önermek',
    content: 'İçerik Üretmek',
    mentorship: 'Mentorluk Yapmak',
    other: 'Diğer',
  },
  verifyLabels: {
    IDENTITY: 'Kimlik Doğrulandı',
    EMPLOYMENT: 'Kurum Doğrulandı',
    EDUCATION: 'Eğitim Doğrulandı',
  },
} as const;

export const profileLabelsEn = {
  locale: 'en-US',
  homePath: '/en/',
  verifyPath: '/en/verify',
  strings: {
    memberFallback: 'Member',
    verifyLabel: 'Verify',
    saving: 'Saving...',
    privacySaved: 'Privacy setting saved',
    privacyError: 'Could not save — reverted',
    profileSaved: 'Profile updated',
    schoolEmailInUse: 'This school email is already in use.',
    schoolEmailInvalid: 'Please enter a valid school email.',
    saveGenericError: 'An error occurred.',
    connectionError: 'Connection error.',
    linkedinVerifiedTitle: 'Verified by LinkedIn',
  },
  badgeMeta: {
    'first-workshop': { icon: '🎓', name: 'First Step', desc: 'Completed first workshop' },
    'three-workshops': { icon: '⭐', name: 'Researcher', desc: 'Completed three workshops' },
    'five-workshops': { icon: '🏆', name: 'Expert Researcher', desc: 'Completed five workshops' },
    'multi-discipline': {
      icon: '🔗',
      name: 'Interdisciplinary',
      desc: 'Joined workshops from 3+ disciplines',
    },
    pioneer: { icon: '🚀', name: 'Pioneer', desc: 'Founding period participant' },
    mentor: { icon: '🧭', name: 'Mentor', desc: 'Contributed mentorship' },
    contributor: { icon: '✍️', name: 'Contributor', desc: 'Active contribution to publications' },
    scholar: { icon: '📖', name: 'Scholar', desc: 'Produced academic publication' },
  },
  certTypes: {
    participation: 'Participation Certificate',
    achievement: 'Achievement Certificate',
    contribution: 'Contribution Certificate',
  },
  statusMap: {
    completed: { label: 'Completed', cls: 'badge-open' },
    accepted: { label: 'Accepted', cls: 'badge-upcoming' },
    pending: { label: 'Pending', cls: 'badge-discipline' },
    rejected: { label: 'Rejected', cls: 'badge-closed' },
  },
  interestLabels: {
    projects: 'Join Projects',
    workshops: 'Workshop Content',
    seminars: 'Propose Seminars',
    content: 'Create Content',
    mentorship: 'Mentorship',
    other: 'Other',
  },
  verifyLabels: {
    IDENTITY: 'Identity Verified',
    EMPLOYMENT: 'Employment Verified',
    EDUCATION: 'Education Verified',
  },
} as const;

export const authStringsTr = {
  defaultError: 'İşlem başarısız.',
  loadTimeout: 'Sayfa yüklenemedi. Lütfen sayfayı yenileyin.',
  notConfigured: 'Sistem yapılandırılmamış. Lütfen info@legereopenedu.com adresine yazın.',
  googleUnavailable:
    'Google servisi yüklenemedi. Reklam engelleyicinizi devre dışı bırakıp sayfayı yenileyin.',
  googleFailed: 'Google ile işlem başarısız. Lütfen tekrar deneyin.',
  connectionError: 'Bağlantı hatası. Lütfen tekrar deneyin.',
  connectionRefresh: 'Bağlantı hatası. Sayfayı yenileyin.',
} as const;

export const authStringsEn = {
  defaultError: 'Something went wrong.',
  loadTimeout: 'Page could not load. Please refresh.',
  notConfigured: 'System is not configured. Please contact info@legereopenedu.com.',
  googleUnavailable: 'Google service could not load. Please disable your ad blocker and refresh.',
  googleFailed: 'Google sign-in failed. Please try again.',
  connectionError: 'Connection error. Please try again.',
  connectionRefresh: 'Connection error. Please refresh.',
} as const;
