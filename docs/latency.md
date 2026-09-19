# Komut gecikmesi kontrolü

## Davranış

- Slash komutları ve panel butonları, veri işlemleri bitmeden Discord'a ilk yanıtını verir.
- Kayıtlı wishlist okuması kullanıcıya ait arka plan işleminin bitmesini beklemez. Yeni hesap, bölge ve dil için eski kayıt kullanılmaz.
- Geçmiş ve bildirim ritmi ekranları Steam'e erişim gerektirmez. Bu ekranlardan wishlist'e geçilirse liste ihtiyaç anında yüklenir.
- Steam yenilemesi sürerken menü, filtre ve sayfa geçişleri kullanılabilir. Aynı panelde tekrarlanan yenilemeler tek istekte birleşir.
- Panel kapandıktan sonra gelen yenileme sonucu paneli yeniden açmaz. Hesap/bölge sürümü değişmişse eski panel yeni veriyi çizmez.
- Oyun kuralları oyun başına sorgulanmaz; kullanıcı ve yapılandırma sürümüne göre tek sorguda alınır. Geçmiş/fiyat geçmişi yalnız ilgili ekranda okunur.

## Ölçüm

`[discord-timing]` kayıtları komutun ilk yanıtını (`ack`), buton yanıtını (`button-ack`), modal açılışını (`modal`), modal yanıtını (`modal-submit-ack`) ve ekran güncellemesini (`render`) ayırır. Assistant veri yüklemesi ayrıca `assistant.load` olarak ölçülür. Panelin açık kalma süresi komut gecikmesi sayılmaz.

Bir işlem 1000 ms veya daha uzun sürerse ya da başarısız olursa kayıt oluşur. Discord ilk yanıtı tamamlandığında etkileşim en az 2000 ms yaşındaysa, istek hızlı tamamlanmış olsa bile kayıt oluşur. `startAgeMs` isteğin başlamadan önceki gecikmesini; `durationMs` ölçülen işlemin süresini gösterir. Kimlikler, tokenlar ve ham Discord yanıtları bu ölçümlere yazılmaz.

Yerel SQLite bellek veritabanında 200 tekrarın medyanı (2026-09-19):

| Oyun | Oyun başına sorgu | Toplu sorgu |
| --- | --- | --- |
| 2 | 0,039 ms | 0,012 ms |
| 50 | 0,448 ms | 0,054 ms |
| 500 | 5,529 ms | 0,473 ms |

Bu değerler yalnız kural okuma maliyetidir; Discord'da uçtan uca hız ölçümü değildir. Gecikme testleri 2 ve 50 oyunla Steam yanıtını bilerek bekletir; menü geçişinin bu yanıt gelmeden tamamlandığını doğrular.

## Doğrulama

Yerel geliştirme makinesinde `npm run typecheck`, `npm test` ve `npm run build` çalıştırılır. Gecikme regresyonları `tests/assistant-latency.test.ts`, `tests/wishlist-view-service.test.ts`, `tests/setup-command.test.ts` ve `tests/interaction-timing.test.ts` içindedir.

Canlı Discord kontrolü: `/dealio`, `/setup`, `/status`, `/wishlist` ekranlarını aç; wishlist yenilenirken geçmişe ve tekrar wishlist'e geç; aynı kontrolleri ikinci bir Discord kullanıcısıyla tekrarla. Sorun varsa yaklaşık saatiyle birlikte ilgili timing kaydını incele. Otomatik testler kullanıcının Discord istemcisindeki görünür gecikmeyi ölçmez.

Mevcut 1 GiB sunucuda tam test paketi çalıştırılmaz. Derleme ve testler yerelde yapılır. Kaynak sürümü, dağıtılan JavaScript dosyaları ve servis sağlığı ayrıca doğrulanır. Steam/Discord kesintileri ve ağ gecikmesi kod optimizasyonuyla sıfırlanamaz; yeni fiyatın doğrulanması için gerçek Steam yanıtı beklenir.
