import type { Language } from '../domain/user-config.js';

interface MessageCatalog {
  readonly setupSuccess: string;
  readonly setupSummarySent: string;
  readonly setupSummaryUnavailable: string;
  readonly setupSummaryDmFailed: string;
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
  readonly statusAccountSection: string;
  readonly statusWishlistSection: string;
  readonly statusCheckSection: string;
  readonly statusNotificationSection: string;
  readonly statusSteamIdLabel: string;
  readonly statusOpenProfile: string;
  readonly statusLanguageLabel: string;
  readonly statusStoreRegionLabel: string;
  readonly statusLatestCurrencyLabel: string;
  readonly statusEnabledLabel: string;
  readonly statusUpdatedAtLabel: string;
  readonly statusEnabled: string;
  readonly statusDisabled: string;
  readonly statusNever: string;
  readonly statusCheckedCountLabel: string;
  readonly statusOnSaleCountLabel: string;
  readonly statusFreeCountLabel: string;
  readonly statusUnknownPriceCountLabel: string;
  readonly statusFailedItemCountLabel: string;
  readonly statusLastSuccessLabel: string;
  readonly statusStartedAtLabel: string;
  readonly statusCompletedAtLabel: string;
  readonly statusResultLabel: string;
  readonly statusNextCheckLabel: string;
  readonly statusErrorLabel: string;
  readonly statusResultSuccess: string;
  readonly statusResultPending: string;
  readonly statusResultUnavailable: string;
  readonly statusResultFailed: string;
  readonly statusSteamUnavailable: string;
  readonly statusCheckFailed: string;
  readonly statusQueuePendingLabel: string;
  readonly statusQueueRetryLabel: string;
  readonly statusQueueSendingLabel: string;
  readonly statusQueueSentLabel: string;
  readonly statusQueueTerminalLabel: string;
  readonly statusQueueExpiredLabel: string;
  readonly statusDisableNotifications: string;
  readonly statusEnableNotifications: string;
  readonly statusToggleFailed: string;
  readonly statusMinimumDiscountLabel: string;
  readonly statusGameOverridesLabel: string;
  readonly statusEditMinimumDiscount: string;
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
    statusAccountSection: '👤 Hesap',
    statusWishlistSection: '🎮 Wishlist özeti',
    statusCheckSection: '🔄 Kontrol durumu',
    statusNotificationSection: '🔔 Bildirim kuyruğu',
    statusSteamIdLabel: 'SteamID64',
    statusOpenProfile: 'Steam profilini aç',
    statusLanguageLabel: 'Bildirim dili',
    statusStoreRegionLabel: 'Steam mağaza bölgesi',
    statusLatestCurrencyLabel: 'Son fiyat para birimi',
    statusEnabledLabel: 'Yapılandırma',
    statusUpdatedAtLabel: 'Güncellendi',
    statusEnabled: 'Aktif',
    statusDisabled: 'Pasif',
    statusNever: 'Henüz yok',
    statusCheckedCountLabel: 'İşlenen oyun',
    statusOnSaleCountLabel: 'İndirimde',
    statusFreeCountLabel: 'Ücretsiz',
    statusUnknownPriceCountLabel: 'Fiyatı bilinmeyen',
    statusFailedItemCountLabel: 'Ayrıntısı alınamayan',
    statusLastSuccessLabel: 'Son başarılı kontrol',
    statusStartedAtLabel: 'Başlangıç',
    statusCompletedAtLabel: 'Tamamlanma',
    statusResultLabel: 'Sonuç',
    statusNextCheckLabel: 'Sonraki otomatik kontrol',
    statusErrorLabel: 'Açıklama',
    statusResultSuccess: 'Başarılı',
    statusResultPending: 'Bekliyor',
    statusResultUnavailable: 'Steam kullanılamıyor',
    statusResultFailed: 'Başarısız',
    statusSteamUnavailable: 'Steam wishlist veya oyun ayrıntıları son kontrolde alınamadı.',
    statusCheckFailed: 'Son kontrol uygulama veya yerel veri sorunu nedeniyle tamamlanamadı.',
    statusQueuePendingLabel: 'Bekleyen',
    statusQueueRetryLabel: 'Tekrar denenecek',
    statusQueueSendingLabel: 'Gönderiliyor',
    statusQueueSentLabel: 'Gönderildi',
    statusQueueTerminalLabel: 'Kalıcı başarısız',
    statusQueueExpiredLabel: 'Süresi doldu',
    statusDisableNotifications: 'Bildirimleri Kapat',
    statusEnableNotifications: 'Bildirimleri Aç',
    statusToggleFailed: 'Bildirim ayarın değiştirilemedi. Daha sonra tekrar dene.',
    statusMinimumDiscountLabel: 'Global minimum indirim',
    statusGameOverridesLabel: 'Oyuna özel kural',
    statusEditMinimumDiscount: 'Minimum İndirimi Değiştir',
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
    statusAccountSection: '👤 Account',
    statusWishlistSection: '🎮 Wishlist summary',
    statusCheckSection: '🔄 Check status',
    statusNotificationSection: '🔔 Notification queue',
    statusSteamIdLabel: 'SteamID64',
    statusOpenProfile: 'Open Steam profile',
    statusLanguageLabel: 'Notification language',
    statusStoreRegionLabel: 'Steam Store region',
    statusLatestCurrencyLabel: 'Latest price currency',
    statusEnabledLabel: 'Configuration',
    statusUpdatedAtLabel: 'Updated',
    statusEnabled: 'Active',
    statusDisabled: 'Disabled',
    statusNever: 'Not yet available',
    statusCheckedCountLabel: 'Games processed',
    statusOnSaleCountLabel: 'On sale',
    statusFreeCountLabel: 'Free',
    statusUnknownPriceCountLabel: 'Unknown price',
    statusFailedItemCountLabel: 'Details unavailable',
    statusLastSuccessLabel: 'Last successful check',
    statusStartedAtLabel: 'Started',
    statusCompletedAtLabel: 'Completed',
    statusResultLabel: 'Result',
    statusNextCheckLabel: 'Next automatic check',
    statusErrorLabel: 'Details',
    statusResultSuccess: 'Successful',
    statusResultPending: 'Pending',
    statusResultUnavailable: 'Steam unavailable',
    statusResultFailed: 'Failed',
    statusSteamUnavailable: 'The Steam wishlist or game details were unavailable during the last check.',
    statusCheckFailed: 'The last check could not complete because of an application or local data problem.',
    statusQueuePendingLabel: 'Pending',
    statusQueueRetryLabel: 'Scheduled for retry',
    statusQueueSendingLabel: 'Sending',
    statusQueueSentLabel: 'Sent',
    statusQueueTerminalLabel: 'Permanently failed',
    statusQueueExpiredLabel: 'Expired',
    statusDisableNotifications: 'Disable notifications',
    statusEnableNotifications: 'Enable notifications',
    statusToggleFailed: 'Your notification setting could not be changed. Try again later.',
    statusMinimumDiscountLabel: 'Global minimum discount',
    statusGameOverridesLabel: 'Game-specific rules',
    statusEditMinimumDiscount: 'Edit minimum discount',
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
