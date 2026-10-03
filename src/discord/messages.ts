import type { Language } from '../domain/user-config.js';

interface MessageCatalog {
  readonly setupSuccess: string;
  readonly setupSummarySent: string;
  readonly setupSummaryUnavailable: string;
  readonly setupWizardTitle: string;
  readonly setupWizardDescription: string;
  readonly setupWizardStart: string;
  readonly setupWizardHow: string;
  readonly setupWizardHowDescription: string;
  readonly setupWizardModalTitle: string;
  readonly setupWizardProfileLabel: string;
  readonly setupWizardProfilePlaceholder: string;
  readonly setupWizardCountryLabel: string;
  readonly setupWizardConfirmTitle: string;
  readonly setupWizardConfirmDescription: string;
  readonly setupWizardProfileField: string;
  readonly setupWizardRegionField: string;
  readonly setupWizardRegionSuggested: string;
  readonly setupWizardRegionSelected: string;
  readonly setupWizardChangeRegion: string;
  readonly setupWizardRegionModalTitle: string;
  readonly setupWizardCountryPickerPlaceholder: string;
  readonly setupWizardLanguageField: string;
  readonly setupWizardFrequencyField: string;
  readonly setupWizardConsentField: string;
  readonly setupWizardConsentValue: string;
  readonly setupWizardEnable: string;
  readonly setupWizardCancel: string;
  readonly setupWizardCancelled: string;
  readonly setupWizardPreparing: string;
  readonly setupWizardDmBlocked: string;
  readonly setupWizardDmTransient: string;
  readonly setupWizardAlreadyCompletedTitle: string;
  readonly setupWizardAlreadyCompletedDescription: string;
  readonly setupWizardFrequency: (hours: number) => string;
  readonly initialSummaryTitle: string;
  readonly initialSummaryDescription: (saleCount: number, incompleteCount?: number) => string;
  readonly initialSummaryIncomplete: string;
  readonly initialSummaryNoSales: string;
  readonly initialSummaryAccount: string;
  readonly initialSummaryRegion: string;
  readonly initialSummaryLanguage: string;
  readonly initialSummarySchedule: string;
  readonly initialSummaryThreshold: string;
  readonly initialSummaryWishlist: string;
  readonly initialSummaryFooter: string;
  readonly invalidSetup: string;
  readonly invalidSteamProfile: string;
  readonly invalidStoreCountry: string;
  readonly vanityProfileNotFound: string;
  readonly vanityResolutionUnavailable: string;
  readonly steamWebApiKeyMissing: string;
  readonly notConfigured: string;
  readonly unavailable: string;
  readonly wishlistInaccessible: string;
  readonly setupValidationUnavailable: string;
  readonly alreadyRunning: string;
  readonly cooldown: (retryAfterSeconds: number) => string;
  readonly failed: string;
  readonly checkCompleted: (
    checkedCount: number,
    candidateCount: number,
    failedCount: number,
    unknownPriceCount: number,
    sentCount: number,
    deliveryFailedCount: number,
  ) => string;
  readonly checkCompletedNotificationsDisabled: (
    checkedCount: number,
    candidateCount: number,
    failedCount: number,
    unknownPriceCount: number,
  ) => string;
  readonly statusNotConfigured: string;
  readonly statusDashboardUnavailable: string;
  readonly statusStoreRegionLabel: string;
  readonly statusMinimumDiscountModalTitle: string;
  readonly statusMinimumDiscountInputLabel: string;
  readonly statusMinimumDiscountPlaceholder: string;
  readonly discountThresholdInvalid: string;
  readonly testNotificationFailed: string;
  readonly testNotificationCooldown: (retryAfterSeconds: number) => string;
  readonly saleNotificationDescription: string;
  readonly testNotificationTitle: string;
  readonly testNotificationDescription: string;
  readonly testNotificationExampleDescription: string;
  readonly discountLabel: string;
  readonly normalPriceLabel: string;
  readonly salePriceLabel: string;
  readonly openSteamStore: string;
  readonly notificationFooter: string;
  readonly regionSaved: (country: string) => string;
  readonly regionUnchanged: (country: string) => string;
  readonly wishlistTitle: string;
  readonly wishlistFailedItems: (count: number) => string;
  readonly wishlistNormalPriceLabel: string;
  readonly wishlistCurrentPriceLabel: string;
  readonly wishlistDiscountValue: (discountPercent: number) => string;
  readonly wishlistFree: string;
  readonly wishlistPriceUnknown: string;
}

const catalog: Record<Language, MessageCatalog> = {
  tr: {
    setupSuccess: 'Steam profilin doğrulandı ve wishlist takibin başladı.',
    setupSummarySent: 'Başlangıç wishlist özetin DM olarak gönderildi.',
    setupSummaryUnavailable: 'Kurulum tamamlandı ancak Steam fiyatları şu anda alınamadığı için başlangıç özeti gönderilemedi. Dealio daha sonra normal kontrollerine devam edecek.',
    setupWizardTitle: 'Dealio\'ya hoş geldin',
    setupWizardDescription: 'Steam wishlistini senin yerine takip eden kişisel indirim asistanın.\n\n'
      + '🔔 **İndirim başlayınca DM** · kendi Steam bölgenin fiyatıyla\n'
      + '🎯 **Kendi kuralların** · oyun başına indirim yüzdesi veya hedef fiyat\n'
      + '📈 **Güvenilir bağlam** · Steam\'deki en düşük fiyatla karşılaştırma\n'
      + '🌙 **Rahatsız etmez** · sessiz saatler veya günlük özet\n\n'
      + '-# Kurulum yaklaşık bir dakika sürer. Parola veya Steam girişi istenmez.',
    setupWizardStart: 'Kurulumu Başlat',
    setupWizardHow: 'Nasıl Çalışır?',
    setupWizardHowDescription: 'Dealio yalnızca herkese açık Steam wishlistini okur. İlk tarama güvenli bir başlangıç kaydıdır; sonraki gerçek indirim başlangıçlarında DM gönderilir. Parola veya Steam oturumu istenmez.',
    setupWizardModalTitle: 'Dealio kurulumu',
    setupWizardProfileLabel: 'Steam profili',
    setupWizardProfilePlaceholder: 'Profil bağlantısı, SteamID64 veya vanity adı',
    setupWizardCountryLabel: 'Steam Store ülkesi',
    setupWizardConfirmTitle: 'Kurulumunu kontrol et',
    setupWizardConfirmDescription: 'Aşağıdaki bilgilerle kişisel indirim DM\'lerini etkinleştirmeye hazırsın.',
    setupWizardProfileField: 'Steam hesabı',
    setupWizardRegionField: 'Mağaza bölgesi',
    setupWizardRegionSuggested: 'Discord diline göre otomatik önerildi. Yanlışsa aşağıdan değiştirebilirsin.',
    setupWizardRegionSelected: 'Senin seçtiğin mağaza bölgesi.',
    setupWizardChangeRegion: 'Bölgeyi Değiştir',
    setupWizardRegionModalTitle: 'Mağaza bölgesini değiştir',
    setupWizardCountryPickerPlaceholder: 'Steam Store ülkeni listeden seç',
    setupWizardLanguageField: 'Bildirim dili',
    setupWizardFrequencyField: 'Kontrol sıklığı',
    setupWizardConsentField: 'DM izni',
    setupWizardConsentValue: 'Onayladığında Dealio sana proaktif indirim DM\'leri gönderebilir.',
    setupWizardEnable: 'Doğru, Bildirimleri Aç',
    setupWizardCancel: 'Vazgeç',
    setupWizardCancelled: 'Kurulum iptal edildi. Hiçbir ayarın değiştirilmedi.',
    setupWizardPreparing: 'Steam profilin ve wishlist erişimin doğrulanıyor…',
    setupWizardDmBlocked: 'Kurulum kaydedildi ancak Discord DM\'lerini engelliyor. Bildirimler güvenli şekilde duraklatıldı; gizlilik ayarını düzelttikten sonra /dealio → ⚙️ Ayarlar üzerinden yeniden açabilirsin.',
    setupWizardDmTransient: 'Kurulum kaydedildi ancak karşılama DM\'i geçici bir Discord sorunu nedeniyle gönderilemedi. Dealio daha sonra normal kontrollerine devam edecek.',
    setupWizardAlreadyCompletedTitle: 'Dealio zaten kurulu',
    setupWizardAlreadyCompletedDescription: 'Bu Discord hesabı için kurulum zaten tamam. Oyunlarını, bildirimlerini ve ayarlarını Dealio panelinden yönetebilirsin. Baştan kurmak istersen önce `/delete-data` ile kayıtlarını sil.',
    setupWizardFrequency: (hours) => hours < 1
      ? `Her ${Math.round(hours * 60)} dakikada bir`
      : `Her ${hours} saatte bir`,
    initialSummaryTitle: 'Hoş geldin! Dealio hazır',
    initialSummaryDescription: (saleCount, incompleteCount = 0) => saleCount > 0
      ? `Wishlistinde şu an **${saleCount}** oyun indirimde; aşağıda tek tek gezebilirsin. Bunlar başlangıç kaydı, bu indirimler için ayrıca DM gelmez. Bundan sonra yeni bir indirim başlayınca haber vereceğim.`
      : incompleteCount > 0 ? 'Doğrulanabilen fiyatlarda indirim bulunamadı. Bazı fiyatlar doğrulanamadı; sonraki kontrolde yeniden denenecek.'
      : 'Wishlistinde şu anda indirimde oyun yok. Bir oyun gerçek bir indirime girdiğinde Dealio sana haber verecek.',
    initialSummaryIncomplete: 'Bazı fiyatlar doğrulanamadı. Listenin tamamında indirim olmadığını henüz söyleyemiyoruz.',
    initialSummaryNoSales: 'İlk tarama tamamlandı. Şu anda indirimde oyun bulunmuyor.',
    initialSummaryAccount: 'Steam hesabı',
    initialSummaryRegion: 'Mağaza bölgesi',
    initialSummaryLanguage: 'Dil',
    initialSummarySchedule: 'Kontrol',
    initialSummaryThreshold: 'Minimum indirim',
    initialSummaryWishlist: 'Wishlist özeti',
    initialSummaryFooter: 'Dealio · Kişisel Steam indirim asistanı',
    invalidSetup: 'Dil Türkçe veya English olmalı.',
    invalidSteamProfile: 'Geçerli bir SteamID64, Steam profil bağlantısı veya vanity adı girmelisin.',
    invalidStoreCountry: 'Geçerli bir Steam mağaza ülkesi seçmelisin.',
    vanityProfileNotFound: 'Bu Steam vanity profili bulunamadı. Profil bağlantısını veya adını kontrol et.',
    vanityResolutionUnavailable: 'Steam profil adı şu anda çözümlenemiyor. Mevcut ayarın değiştirilmedi; daha sonra tekrar dene.',
    steamWebApiKeyMissing: 'Steam profil adlarını çözümleme özelliği şu anda yapılandırılmamış. SteamID64 veya /profiles/ bağlantısı kullanabilirsin.',
    notConfigured: 'Önce /setup komutuyla Steam wishlist ayarını yapmalısın.',
    unavailable: 'Steam wishlist kontrolü şu anda kullanılamıyor.',
    wishlistInaccessible: 'Steam wishlist erişilemiyor. SteamID64 değerini kontrol et; Steam profilin ve Oyun Ayrıntıları görünürlüğün Herkese Açık olmalı.',
    setupValidationUnavailable: 'Steam wishlist erişimi şu anda doğrulanamadı. Mevcut ayarın değiştirilmedi; daha sonra tekrar dene.',
    alreadyRunning: 'Wishlist kontrolün zaten devam ediyor.',
    cooldown: (retryAfterSeconds) =>
      `Yeni kontrol için ${retryAfterSeconds} saniye beklemelisin.`,
    failed: 'Wishlist kontrolü yerel veri hatası nedeniyle tamamlanamadı.',
    checkCompleted: (
      checkedCount,
      candidateCount,
      failedCount,
      unknownPriceCount,
      sentCount,
      deliveryFailedCount,
    ) =>
      `Wishlist kontrolü tamamlandı: ${checkedCount} oyun işlendi, ${candidateCount} bildirim adayı kaydedildi, ${sentCount} oyun bildirimi teslim edildi, ${deliveryFailedCount} oyun bildirimi başarısız, ${failedCount} oyun hatalı, ${unknownPriceCount} oyunun fiyatı bilinmiyor.`,
    checkCompletedNotificationsDisabled: (
      checkedCount,
      candidateCount,
      failedCount,
      unknownPriceCount,
    ) => `Wishlist kontrolü tamamlandı: ${checkedCount} oyun işlendi, ${candidateCount} bildirim adayı kuyrukta tutuldu, ${failedCount} oyun hatalı, ${unknownPriceCount} oyunun fiyatı bilinmiyor. Bildirimlerin kapalı olduğu için DM gönderilmedi.`,
    statusNotConfigured: 'Henüz bir Steam wishlist ayarın yok. /setup komutunu kullanabilirsin.',
    statusDashboardUnavailable: 'Durum bilgilerin şu anda güvenli şekilde okunamıyor. Daha sonra tekrar dene.',
    statusStoreRegionLabel: 'Steam mağaza bölgesi',
    statusMinimumDiscountModalTitle: 'Global minimum indirim',
    statusMinimumDiscountInputLabel: 'Minimum indirim yüzdesi (0-100)',
    statusMinimumDiscountPlaceholder: 'Örnek: 30',
    discountThresholdInvalid: '0 ile 100 arasında bir tam sayı girmelisin.',
    testNotificationFailed: 'Test bildirimi gönderilemedi. Bunun nedeni geçici bir Discord sorunu veya DM gizlilik ayarların olabilir. Ayarlarını kontrol edip daha sonra tekrar dene.',
    testNotificationCooldown: (retryAfterSeconds) =>
      `Yeni bir test bildirimi için ${retryAfterSeconds} saniye beklemelisin.`,
    saleNotificationDescription: 'Wishlistindeki bir oyun indirime girdi.',
    testNotificationTitle: 'Dealio test bildirimi',
    testNotificationDescription: 'Bu bir test: gerçek bildirimlerin tam olarak böyle görünür. Oyun ve fiyat wishlistinden alındı.',
    testNotificationExampleDescription: 'Bu bir test: gerçek bildirimlerin böyle görünür. Wishlistinde şu an indirim olmadığı için örnek bir oyun gösteriliyor.',
    discountLabel: 'İndirim',
    normalPriceLabel: 'Normal fiyat',
    salePriceLabel: 'İndirimli fiyat',
    openSteamStore: 'Steam mağazasında aç',
    notificationFooter: 'Dealio · Steam wishlist bildirimi',
    regionSaved: (country) => `Steam mağaza bölgen ${country} olarak kaydedildi. Yeni bölgedeki ilk kontrol bildirim üretmeyen bir başlangıç verisi oluşturacak.`,
    regionUnchanged: (country) => `Steam mağaza bölgen zaten ${country}.`,
    wishlistTitle: 'Steam wishlistin',
    wishlistFailedItems: (count) => `${count} oyunun ayrıntıları Steam'den alınamadı.`,
    wishlistNormalPriceLabel: 'Normal fiyat',
    wishlistCurrentPriceLabel: 'Güncel fiyat',
    wishlistDiscountValue: (discountPercent) => `🟢 **%${discountPercent} indirim**`,
    wishlistFree: 'Ücretsiz',
    wishlistPriceUnknown: 'Fiyat bilgisi Steam tarafından sağlanmadı.',
  },
  en: {
    setupSuccess: 'Your Steam profile was verified and wishlist tracking has started.',
    setupSummarySent: 'Your initial wishlist summary was sent by DM.',
    setupSummaryUnavailable: 'Setup is complete, but Steam prices are currently unavailable, so the initial summary could not be sent. Dealio will continue with its normal checks.',
    setupWizardTitle: 'Welcome to Dealio',
    setupWizardDescription: 'Your personal sale assistant that watches your Steam wishlist for you.\n\n'
      + '🔔 **A DM when a sale starts** · with your own Steam region\'s price\n'
      + '🎯 **Your own rules** · a discount % or target price per game\n'
      + '📈 **Context you can trust** · compared with Steam\'s lowest price\n'
      + '🌙 **Never a nuisance** · quiet hours or a daily digest\n\n'
      + '-# Setup takes about a minute. No password or Steam login.',
    setupWizardStart: 'Start Setup',
    setupWizardHow: 'How It Works',
    setupWizardHowDescription: 'Dealio reads only your public Steam wishlist. The first scan is a safe baseline; later real sale starts can create DMs. It never asks for a password or Steam session.',
    setupWizardModalTitle: 'Dealio setup',
    setupWizardProfileLabel: 'Steam profile',
    setupWizardProfilePlaceholder: 'Profile link, SteamID64, or vanity name',
    setupWizardCountryLabel: 'Steam Store country',
    setupWizardConfirmTitle: 'Review your setup',
    setupWizardConfirmDescription: 'You are ready to enable personal sale DMs with the details below.',
    setupWizardProfileField: 'Steam account',
    setupWizardRegionField: 'Store region',
    setupWizardRegionSuggested: 'Suggested automatically from your Discord language. Change it below if it is wrong.',
    setupWizardRegionSelected: 'Store region selected by you.',
    setupWizardChangeRegion: 'Change Region',
    setupWizardRegionModalTitle: 'Change Store region',
    setupWizardCountryPickerPlaceholder: 'Select your Steam Store country',
    setupWizardLanguageField: 'Notification language',
    setupWizardFrequencyField: 'Check frequency',
    setupWizardConsentField: 'DM consent',
    setupWizardConsentValue: 'By confirming, you allow Dealio to send proactive sale DMs.',
    setupWizardEnable: 'Correct, Enable Notifications',
    setupWizardCancel: 'Cancel',
    setupWizardCancelled: 'Setup cancelled. None of your settings were changed.',
    setupWizardPreparing: 'Verifying your Steam profile and wishlist access…',
    setupWizardDmBlocked: 'Setup was saved, but Discord is blocking DMs. Notifications were safely paused; fix your privacy setting and turn them back on in /dealio → ⚙️ Settings.',
    setupWizardDmTransient: 'Setup was saved, but the welcome DM could not be sent because of a temporary Discord problem. Dealio will continue its normal checks.',
    setupWizardAlreadyCompletedTitle: 'Dealio is already configured',
    setupWizardAlreadyCompletedDescription: 'Setup is already complete for this Discord account. Manage your games, alerts and settings from the Dealio panel. To start over, delete your records with `/delete-data` first.',
    setupWizardFrequency: (hours) => hours < 1
      ? `Every ${Math.round(hours * 60)} minutes`
      : hours === 1 ? 'Every hour' : `Every ${hours} hours`,
    initialSummaryTitle: 'Welcome! Dealio is ready',
    initialSummaryDescription: (saleCount, incompleteCount = 0) => saleCount > 0
      ? `**${saleCount}** games on your wishlist are on sale right now; browse them one by one below. This is your starting snapshot, so these sales will not DM you again. From now on I will let you know when a new sale starts.`
      : incompleteCount > 0 ? 'No discounts were found among verified prices. Some prices could not be verified and will be retried on the next check.'
      : 'There are no discounted games on your wishlist right now. Dealio will notify you when a real sale begins.',
    initialSummaryIncomplete: 'Some prices could not be verified. We cannot yet say the entire wishlist has no discounts.',
    initialSummaryNoSales: 'The first scan is complete. No games are currently discounted.',
    initialSummaryAccount: 'Steam account',
    initialSummaryRegion: 'Store region',
    initialSummaryLanguage: 'Language',
    initialSummarySchedule: 'Checks',
    initialSummaryThreshold: 'Minimum discount',
    initialSummaryWishlist: 'Wishlist summary',
    initialSummaryFooter: 'Dealio · Personal Steam sale assistant',
    invalidSetup: 'Language must be Turkish or English.',
    invalidSteamProfile: 'Enter a valid SteamID64, Steam profile link, or vanity name.',
    invalidStoreCountry: 'Select a valid Steam Store country.',
    vanityProfileNotFound: 'That Steam vanity profile was not found. Check the profile link or name.',
    vanityResolutionUnavailable: 'The Steam profile name cannot be resolved right now. Your existing configuration was not changed; try again later.',
    steamWebApiKeyMissing: 'Steam profile-name resolution is not configured right now. You can use a SteamID64 or /profiles/ link instead.',
    notConfigured: 'Configure your Steam wishlist first with /setup.',
    unavailable: 'The Steam wishlist check is currently unavailable.',
    wishlistInaccessible: 'The Steam wishlist is inaccessible. Check the SteamID64 and make both the Steam profile and Game details public.',
    setupValidationUnavailable: 'Steam wishlist access could not be verified right now. Your existing configuration was not changed; try again later.',
    alreadyRunning: 'Your wishlist check is already running.',
    cooldown: (retryAfterSeconds) =>
      `Wait ${retryAfterSeconds} seconds before starting another check.`,
    failed: 'The wishlist check could not complete because of a local data error.',
    checkCompleted: (
      checkedCount,
      candidateCount,
      failedCount,
      unknownPriceCount,
      sentCount,
      deliveryFailedCount,
    ) =>
      `Wishlist check completed: ${checkedCount} games processed, ${candidateCount} notification candidates recorded, ${sentCount} game notifications delivered, ${deliveryFailedCount} game notifications failed, ${failedCount} games failed, ${unknownPriceCount} prices unknown.`,
    checkCompletedNotificationsDisabled: (
      checkedCount,
      candidateCount,
      failedCount,
      unknownPriceCount,
    ) => `Wishlist check completed: ${checkedCount} games processed, ${candidateCount} notification candidates remain queued, ${failedCount} games failed, ${unknownPriceCount} prices unknown. No DM was sent because notifications are disabled.`,
    statusNotConfigured: 'You do not have a Steam wishlist configured yet. Use /setup first.',
    statusDashboardUnavailable: 'Your status data cannot be read safely right now. Try again later.',
    statusStoreRegionLabel: 'Steam Store region',
    statusMinimumDiscountModalTitle: 'Global minimum discount',
    statusMinimumDiscountInputLabel: 'Minimum discount percent (0-100)',
    statusMinimumDiscountPlaceholder: 'Example: 30',
    discountThresholdInvalid: 'Enter a whole number between 0 and 100.',
    testNotificationFailed: 'The test notification could not be sent. This may be caused by a temporary Discord issue or your DM privacy settings. Check your settings and try again later.',
    testNotificationCooldown: (retryAfterSeconds) =>
      `Wait ${retryAfterSeconds} seconds before sending another test notification.`,
    saleNotificationDescription: 'A game on your wishlist is now on sale.',
    testNotificationTitle: 'Dealio test notification',
    testNotificationDescription: 'This is a test: your real alerts look exactly like this. The game and price come from your wishlist.',
    testNotificationExampleDescription: 'This is a test: your real alerts look like this. Nothing on your wishlist is on sale right now, so an example game is shown.',
    discountLabel: 'Discount',
    normalPriceLabel: 'Normal price',
    salePriceLabel: 'Sale price',
    openSteamStore: 'Open in Steam Store',
    notificationFooter: 'Dealio · Steam wishlist notification',
    regionSaved: (country) => `Your Steam Store region is now ${country}. The first check in the new region will establish a notification-free baseline.`,
    regionUnchanged: (country) => `Your Steam Store region is already ${country}.`,
    wishlistTitle: 'Your Steam wishlist',
    wishlistFailedItems: (count) => `Steam details could not be loaded for ${count} games.`,
    wishlistNormalPriceLabel: 'Normal price',
    wishlistCurrentPriceLabel: 'Current price',
    wishlistDiscountValue: (discountPercent) => `🟢 **${discountPercent}% discount**`,
    wishlistFree: 'Free',
    wishlistPriceUnknown: 'Steam did not provide price information.',
  },
};

export function messagesFor(language: Language): MessageCatalog {
  return catalog[language];
}
