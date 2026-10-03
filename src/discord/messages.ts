import type { Language } from '../domain/user-config.js';

interface MessageCatalog {
  readonly setupSuccess: string;
  readonly setupSummarySent: string;
  readonly setupSummaryUnavailable: string;
  readonly setupSummaryDmFailed: string;
  readonly setupWizardTitle: string;
  readonly setupWizardDescription: string;
  readonly setupWizardStart: string;
  readonly setupWizardHow: string;
  readonly setupWizardHowDescription: string;
  readonly setupWizardModalTitle: string;
  readonly setupWizardProfileLabel: string;
  readonly setupWizardProfilePlaceholder: string;
  readonly setupWizardCountryLabel: string;
  readonly setupWizardCountryPlaceholder: string;
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
  readonly setupWizardExpired: string;
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
  readonly statusTitle: string;
  readonly statusDashboardUnavailable: string;
  readonly statusStoreRegionLabel: string;
  readonly statusDisabled: string;
  readonly statusToggleFailed: string;
  readonly statusRegionSaved: (country: string) => string;
  readonly statusRegionSaveFailed: string;
  readonly statusMinimumDiscountModalTitle: string;
  readonly statusMinimumDiscountInputLabel: string;
  readonly statusMinimumDiscountPlaceholder: string;
  readonly statusMinimumDiscountSaved: (percent: number) => string;
  readonly discountThresholdInvalid: string;
  readonly discountThresholdSaveFailed: string;
  readonly deleteSuccess: string;
  readonly deleteNoData: string;
  readonly deleteNotConfirmed: string;
  readonly testNotificationSent: string;
  readonly testNotificationFailed: string;
  readonly testNotificationCooldown: (retryAfterSeconds: number) => string;
  readonly saleNotificationDescription: string;
  readonly testNotificationTitle: string;
  readonly testNotificationDescription: string;
  readonly discountLabel: string;
  readonly normalPriceLabel: string;
  readonly salePriceLabel: string;
  readonly openSteamStore: string;
  readonly notificationFooter: string;
  readonly regionSaved: (country: string) => string;
  readonly regionUnchanged: (country: string) => string;
  readonly wishlistTitle: string;
  readonly wishlistEmpty: string;
  readonly wishlistUnavailable: string;
  readonly wishlistTotalGamesLabel: string;
  readonly wishlistOnSaleGamesLabel: string;
  readonly wishlistFreeGamesLabel: string;
  readonly wishlistFetchedAtLabel: string;
  readonly wishlistFailedItems: (count: number) => string;
  readonly wishlistPage: (current: number, total: number) => string;
  readonly wishlistNormalPriceLabel: string;
  readonly wishlistCurrentPriceLabel: string;
  readonly wishlistDiscountLabel: string;
  readonly wishlistDiscountValue: (discountPercent: number) => string;
  readonly wishlistPriceLabel: string;
  readonly wishlistFree: string;
  readonly wishlistPriceUnknown: string;
  readonly wishlistPriorityLabel: string;
  readonly wishlistPriorityValue: (priority: number) => string;
  readonly wishlistAddedAtLabel: string;
  readonly wishlistOpenStore: string;
  readonly wishlistPrevious: string;
  readonly wishlistNext: string;
  readonly wishlistClose: string;
  readonly wishlistMinimumDiscountLabel: string;
  readonly wishlistThresholdGlobal: (percent: number) => string;
  readonly wishlistThresholdOverride: (percent: number) => string;
  readonly wishlistEditThreshold: (gameName: string) => string;
  readonly wishlistThresholdModalTitle: string;
  readonly wishlistThresholdInputLabel: string;
  readonly wishlistThresholdPlaceholder: string;
  readonly wishlistThresholdSaved: (gameName: string, percent: number) => string;
  readonly wishlistThresholdReset: (gameName: string, percent: number) => string;
}

const catalog: Record<Language, MessageCatalog> = {
  tr: {
    setupSuccess: 'Steam profilin doğrulandı ve wishlist ayarın kaydedildi. Bildirimler aktif.',
    setupSummarySent: 'Başlangıç wishlist özetin DM olarak gönderildi.',
    setupSummaryUnavailable: 'Kurulum tamamlandı ancak Steam fiyatları şu anda alınamadığı için başlangıç özeti gönderilemedi. Dealio daha sonra normal kontrollerine devam edecek.',
    setupSummaryDmFailed: 'Kurulum tamamlandı ancak başlangıç özeti DM olarak gönderilemedi. Discord DM gizlilik ayarlarını kontrol edebilirsin.',
    setupWizardTitle: 'Dealio\'ya hoş geldin',
    setupWizardDescription: 'Steam wishlistindeki gerçek indirimleri, seçtiğin mağaza bölgesinin fiyatlarıyla doğrudan DM kutuna getirir. Kurulum yaklaşık bir dakika sürer.',
    setupWizardStart: 'Kurulumu Başlat',
    setupWizardHow: 'Nasıl Çalışır?',
    setupWizardHowDescription: 'Dealio yalnızca herkese açık Steam wishlistini okur. İlk tarama güvenli bir başlangıç kaydıdır; sonraki gerçek indirim başlangıçlarında DM gönderilir. Parola veya Steam oturumu istenmez.',
    setupWizardModalTitle: 'Dealio kurulumu',
    setupWizardProfileLabel: 'Steam profili',
    setupWizardProfilePlaceholder: 'Profil bağlantısı, SteamID64 veya vanity adı',
    setupWizardCountryLabel: 'Steam Store ülkesi',
    setupWizardCountryPlaceholder: 'TR, Türkiye veya Turkey',
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
    setupWizardExpired: 'Bu kurulum oturumunun süresi doldu. Yeniden başlamak için /setup kullanabilirsin.',
    setupWizardPreparing: 'Steam profilin ve wishlist erişimin doğrulanıyor…',
    setupWizardDmBlocked: 'Kurulum kaydedildi ancak Discord DM\'lerini engelliyor. Bildirimler güvenli şekilde duraklatıldı; gizlilik ayarını düzelttikten sonra /status üzerinden yeniden etkinleştirebilirsin.',
    setupWizardDmTransient: 'Kurulum kaydedildi ancak karşılama DM\'i geçici bir Discord sorunu nedeniyle gönderilemedi. Dealio daha sonra normal kontrollerine devam edecek.',
    setupWizardAlreadyCompletedTitle: 'Dealio zaten kurulu',
    setupWizardAlreadyCompletedDescription: 'Bu Discord hesabı için `/setup` daha önce tamamlanmış. Mevcut ayarlarını `/dealio`, `/status`, `/region` ve `/wishlist` ile yönetebilirsin. Baştan kurmak istiyorsan `/delete-data` içindeki güvenli onay ekranıyla kayıtlarını kalıcı olarak silmelisin.',
    setupWizardFrequency: (hours) => hours < 1
      ? `Her ${Math.round(hours * 60)} dakikada bir`
      : `Her ${hours} saatte bir`,
    initialSummaryTitle: 'Dealio hazır — indirim nöbetin başladı',
    initialSummaryDescription: (saleCount, incompleteCount = 0) => saleCount > 0
      ? `Wishlistinde şu anda indirimde olan ${saleCount} oyun aşağıda. Bunlar başlangıç kaydıdır; indirimden çıkıp yeniden indirime girmeden tekrar bildirilmez.`
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
    statusTitle: 'Steam wishlist dashboardun',
    statusDashboardUnavailable: 'Durum bilgilerin şu anda güvenli şekilde okunamıyor. Daha sonra tekrar dene.',
    statusStoreRegionLabel: 'Steam mağaza bölgesi',
    statusDisabled: 'Pasif',
    statusToggleFailed: 'Bildirim ayarın değiştirilemedi. Daha sonra tekrar dene.',
    statusRegionSaved: (country) => `Steam Store bölgen ${country} olarak kaydedildi. Fiyat başlangıç kaydı güvenli biçimde yenilendi.`,
    statusRegionSaveFailed: 'Mağaza bölgen kaydedilemedi. Geçerli bir ülke girip tekrar dene.',
    statusMinimumDiscountModalTitle: 'Global minimum indirim',
    statusMinimumDiscountInputLabel: 'Minimum indirim yüzdesi (0-100)',
    statusMinimumDiscountPlaceholder: 'Örnek: 30',
    statusMinimumDiscountSaved: (percent) => `Global minimum indirim %${percent} olarak kaydedildi.`,
    discountThresholdInvalid: '0 ile 100 arasında bir tam sayı girmelisin.',
    discountThresholdSaveFailed: 'Minimum indirim ayarın kaydedilemedi. Daha sonra tekrar dene.',
    deleteSuccess: 'Saklanan Steam wishlist ayarın ve bildirim geçmişin silindi.',
    deleteNoData: 'Silinecek kayıtlı verin bulunamadı.',
    deleteNotConfirmed: 'Veriler silinmedi. Kalıcı silme için confirm seçeneğini onayla.',
    testNotificationSent: 'Test bildirimi DM olarak gönderildi. Gelen kutunu kontrol edebilirsin.',
    testNotificationFailed: 'Test bildirimi gönderilemedi. Bunun nedeni geçici bir Discord sorunu veya DM gizlilik ayarların olabilir. Ayarlarını kontrol edip daha sonra tekrar dene.',
    testNotificationCooldown: (retryAfterSeconds) =>
      `Yeni bir test bildirimi için ${retryAfterSeconds} saniye beklemelisin.`,
    saleNotificationDescription: 'Wishlistindeki bir oyun indirime girdi.',
    testNotificationTitle: 'Dealio test bildirimi',
    testNotificationDescription: 'DM kanalın ve bildirim tasarımın çalışıyor. Aşağıdaki satış yalnızca örnektir.',
    discountLabel: 'İndirim',
    normalPriceLabel: 'Normal fiyat',
    salePriceLabel: 'İndirimli fiyat',
    openSteamStore: 'Steam mağazasında aç',
    notificationFooter: 'Dealio · Steam wishlist bildirimi',
    regionSaved: (country) => `Steam mağaza bölgen ${country} olarak kaydedildi. Yeni bölgedeki ilk kontrol bildirim üretmeyen bir başlangıç verisi oluşturacak.`,
    regionUnchanged: (country) => `Steam mağaza bölgen zaten ${country}.`,
    wishlistTitle: 'Steam wishlistin',
    wishlistEmpty: 'Wishlistinde henüz oyun bulunmuyor.',
    wishlistUnavailable: 'Steam wishlist veya oyun ayrıntıları şu anda yüklenemedi. Daha sonra tekrar dene.',
    wishlistTotalGamesLabel: 'Toplam oyun',
    wishlistOnSaleGamesLabel: 'İndirimde',
    wishlistFreeGamesLabel: 'Ücretsiz',
    wishlistFetchedAtLabel: 'Veri zamanı',
    wishlistFailedItems: (count) => `${count} oyunun ayrıntıları Steam'den alınamadı.`,
    wishlistPage: (current, total) => `Sayfa ${current}/${total}`,
    wishlistNormalPriceLabel: 'Normal fiyat',
    wishlistCurrentPriceLabel: 'Güncel fiyat',
    wishlistDiscountLabel: 'İndirim',
    wishlistDiscountValue: (discountPercent) => `🟢 **%${discountPercent} indirim**`,
    wishlistPriceLabel: 'Fiyat',
    wishlistFree: 'Ücretsiz',
    wishlistPriceUnknown: 'Fiyat bilgisi Steam tarafından sağlanmadı.',
    wishlistPriorityLabel: 'Öncelik',
    wishlistPriorityValue: (priority) => `#${priority}`,
    wishlistAddedAtLabel: 'Eklenme tarihi',
    wishlistOpenStore: 'Steam mağazasında aç',
    wishlistPrevious: 'Önceki',
    wishlistNext: 'Sonraki',
    wishlistClose: 'Kapat',
    wishlistMinimumDiscountLabel: 'Bildirim eşiği',
    wishlistThresholdGlobal: (percent) => `%${percent} (global)`,
    wishlistThresholdOverride: (percent) => `%${percent} (bu oyuna özel)`,
    wishlistEditThreshold: (gameName) => `${gameName} eşiğini değiştir`,
    wishlistThresholdModalTitle: 'Oyun minimum indirimi',
    wishlistThresholdInputLabel: 'Minimum indirim (0-100, boş = global)',
    wishlistThresholdPlaceholder: 'Örnek: 50 veya global için boş bırak',
    wishlistThresholdSaved: (gameName, percent) => `${gameName} için minimum indirim %${percent} olarak kaydedildi.`,
    wishlistThresholdReset: (gameName, percent) => `${gameName} global eşiğe döndü (%${percent}).`,
  },
  en: {
    setupSuccess: 'Your Steam profile was verified and wishlist notifications are configured.',
    setupSummarySent: 'Your initial wishlist summary was sent by DM.',
    setupSummaryUnavailable: 'Setup is complete, but Steam prices are currently unavailable, so the initial summary could not be sent. Dealio will continue with its normal checks.',
    setupSummaryDmFailed: 'Setup is complete, but the initial summary DM could not be sent. Check your Discord DM privacy settings.',
    setupWizardTitle: 'Welcome to Dealio',
    setupWizardDescription: 'Dealio sends real Steam wishlist sales to your DMs using prices from your selected Store region. Setup takes about a minute.',
    setupWizardStart: 'Start Setup',
    setupWizardHow: 'How It Works',
    setupWizardHowDescription: 'Dealio reads only your public Steam wishlist. The first scan is a safe baseline; later real sale starts can create DMs. It never asks for a password or Steam session.',
    setupWizardModalTitle: 'Dealio setup',
    setupWizardProfileLabel: 'Steam profile',
    setupWizardProfilePlaceholder: 'Profile link, SteamID64, or vanity name',
    setupWizardCountryLabel: 'Steam Store country',
    setupWizardCountryPlaceholder: 'US, United States, TR, or Turkey',
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
    setupWizardExpired: 'This setup session expired. Use /setup to start again.',
    setupWizardPreparing: 'Verifying your Steam profile and wishlist access…',
    setupWizardDmBlocked: 'Setup was saved, but Discord is blocking DMs. Notifications were safely paused; fix your privacy setting and re-enable them from /status.',
    setupWizardDmTransient: 'Setup was saved, but the welcome DM could not be sent because of a temporary Discord problem. Dealio will continue its normal checks.',
    setupWizardAlreadyCompletedTitle: 'Dealio is already configured',
    setupWizardAlreadyCompletedDescription: '`/setup` has already been completed for this Discord account. Manage it with `/dealio`, `/status`, `/region`, and `/wishlist`. To start over, permanently delete your records through the safe confirmation flow in `/delete-data`.',
    setupWizardFrequency: (hours) => hours < 1
      ? `Every ${Math.round(hours * 60)} minutes`
      : hours === 1 ? 'Every hour' : `Every ${hours} hours`,
    initialSummaryTitle: 'Dealio is ready — your sale watch has started',
    initialSummaryDescription: (saleCount, incompleteCount = 0) => saleCount > 0
      ? `${saleCount} games on your wishlist are currently discounted below. This is your starting snapshot; they will not alert again until they leave the sale and go on sale again.`
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
    statusTitle: 'Your Steam wishlist dashboard',
    statusDashboardUnavailable: 'Your status data cannot be read safely right now. Try again later.',
    statusStoreRegionLabel: 'Steam Store region',
    statusDisabled: 'Disabled',
    statusToggleFailed: 'Your notification setting could not be changed. Try again later.',
    statusRegionSaved: (country) => `Your Steam Store region was saved as ${country}. The price baseline was refreshed safely.`,
    statusRegionSaveFailed: 'Your Store region could not be saved. Enter a valid country and try again.',
    statusMinimumDiscountModalTitle: 'Global minimum discount',
    statusMinimumDiscountInputLabel: 'Minimum discount percent (0-100)',
    statusMinimumDiscountPlaceholder: 'Example: 30',
    statusMinimumDiscountSaved: (percent) => `Global minimum discount saved as ${percent}%.`,
    discountThresholdInvalid: 'Enter a whole number between 0 and 100.',
    discountThresholdSaveFailed: 'Your minimum discount setting could not be saved. Try again later.',
    deleteSuccess: 'Your stored Steam wishlist configuration and notification history were deleted.',
    deleteNoData: 'No stored data was found to delete.',
    deleteNotConfirmed: 'No data was deleted. Enable confirm to permanently delete it.',
    testNotificationSent: 'The test notification was sent by DM. You can check your inbox.',
    testNotificationFailed: 'The test notification could not be sent. This may be caused by a temporary Discord issue or your DM privacy settings. Check your settings and try again later.',
    testNotificationCooldown: (retryAfterSeconds) =>
      `Wait ${retryAfterSeconds} seconds before sending another test notification.`,
    saleNotificationDescription: 'A game on your wishlist is now on sale.',
    testNotificationTitle: 'Dealio test notification',
    testNotificationDescription: 'Your DM channel and notification design are working. The sale below is only an example.',
    discountLabel: 'Discount',
    normalPriceLabel: 'Normal price',
    salePriceLabel: 'Sale price',
    openSteamStore: 'Open in Steam Store',
    notificationFooter: 'Dealio · Steam wishlist notification',
    regionSaved: (country) => `Your Steam Store region is now ${country}. The first check in the new region will establish a notification-free baseline.`,
    regionUnchanged: (country) => `Your Steam Store region is already ${country}.`,
    wishlistTitle: 'Your Steam wishlist',
    wishlistEmpty: 'Your wishlist does not contain any games yet.',
    wishlistUnavailable: 'The Steam wishlist or game details could not be loaded right now. Try again later.',
    wishlistTotalGamesLabel: 'Total games',
    wishlistOnSaleGamesLabel: 'On sale',
    wishlistFreeGamesLabel: 'Free',
    wishlistFetchedAtLabel: 'Data fetched',
    wishlistFailedItems: (count) => `Steam details could not be loaded for ${count} games.`,
    wishlistPage: (current, total) => `Page ${current}/${total}`,
    wishlistNormalPriceLabel: 'Normal price',
    wishlistCurrentPriceLabel: 'Current price',
    wishlistDiscountLabel: 'Discount',
    wishlistDiscountValue: (discountPercent) => `🟢 **${discountPercent}% discount**`,
    wishlistPriceLabel: 'Price',
    wishlistFree: 'Free',
    wishlistPriceUnknown: 'Steam did not provide price information.',
    wishlistPriorityLabel: 'Priority',
    wishlistPriorityValue: (priority) => `#${priority}`,
    wishlistAddedAtLabel: 'Date added',
    wishlistOpenStore: 'Open in Steam Store',
    wishlistPrevious: 'Previous',
    wishlistNext: 'Next',
    wishlistClose: 'Close',
    wishlistMinimumDiscountLabel: 'Notification threshold',
    wishlistThresholdGlobal: (percent) => `${percent}% (global)`,
    wishlistThresholdOverride: (percent) => `${percent}% (game-specific)`,
    wishlistEditThreshold: (gameName) => `Edit ${gameName} threshold`,
    wishlistThresholdModalTitle: 'Game minimum discount',
    wishlistThresholdInputLabel: 'Minimum discount (0-100, blank = global)',
    wishlistThresholdPlaceholder: 'Example: 50, or leave blank for global',
    wishlistThresholdSaved: (gameName, percent) => `${gameName} minimum discount saved as ${percent}%.`,
    wishlistThresholdReset: (gameName, percent) => `${gameName} now uses the global threshold (${percent}%).`,
  },
};

export function messagesFor(language: Language): MessageCatalog {
  return catalog[language];
}
