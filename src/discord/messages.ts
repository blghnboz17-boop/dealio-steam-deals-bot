import type { Language } from '../domain/user-config.js';

interface MessageCatalog {
  readonly setupSuccess: string;
  readonly invalidSetup: string;
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
  readonly statusNotConfigured: string;
  readonly deleteSuccess: string;
  readonly deleteNoData: string;
  readonly deleteNotConfirmed: string;
}

const catalog: Record<Language, MessageCatalog> = {
  tr: {
    setupSuccess: 'Steam wishlist ayarın kaydedildi. Bildirimler aktif.',
    invalidSetup: 'SteamID64 17 haneli sayısal bir değer, dil ise Türkçe veya English olmalı.',
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
      `Wishlist kontrolü tamamlandı: ${checkedCount} oyun işlendi, ${candidateCount} bildirim adayı kaydedildi, ${sentCount} DM gönderildi, ${deliveryFailedCount} DM başarısız, ${failedCount} oyun hatalı, ${unknownPriceCount} oyunun fiyatı bilinmiyor.`,
    statusNotConfigured: 'Henüz bir Steam wishlist ayarın yok. /setup komutunu kullanabilirsin.',
    deleteSuccess: 'Saklanan Steam wishlist ayarın ve bildirim geçmişin silindi.',
    deleteNoData: 'Silinecek kayıtlı verin bulunamadı.',
    deleteNotConfirmed: 'Veriler silinmedi. Kalıcı silme için confirm seçeneğini onayla.',
  },
  en: {
    setupSuccess: 'Your Steam wishlist is configured. Notifications are enabled.',
    invalidSetup: 'SteamID64 must be 17 digits and language must be Turkish or English.',
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
      `Wishlist check completed: ${checkedCount} games processed, ${candidateCount} notification candidates recorded, ${sentCount} DMs sent, ${deliveryFailedCount} DMs failed, ${failedCount} games failed, ${unknownPriceCount} prices unknown.`,
    statusNotConfigured: 'You do not have a Steam wishlist configured yet. Use /setup first.',
    deleteSuccess: 'Your stored Steam wishlist configuration and notification history were deleted.',
    deleteNoData: 'No stored data was found to delete.',
    deleteNotConfirmed: 'No data was deleted. Enable confirm to permanently delete it.',
  },
};

export function messagesFor(language: Language): MessageCatalog {
  return catalog[language];
}
