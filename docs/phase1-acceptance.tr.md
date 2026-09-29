# 1. aşama kabul kaydı — 29 Eylül 2026

Bu aşamanın kapsamı kesin sürümü belirlemek, mevcut işletim durumunu doğrulamak ve gerçek kullanım için başlangıç ölçümlerini toplamaktır. Açık beta kapasite veya genel yayın kabulü değildir. Kaynak repo özel kalır.

## Ölçülen sonuçlar

| Kontrol | Kanıt |
| --- | --- |
| Discord ilk yanıt | İlk üç komut 470, 483 ve 729 ms; sonraki test komutu 459 ms. Üç saniyeyi aşan veya başarısız ilk yanıt yok. |
| Gerçek kullanıcı akışı | Kullanıcı `/dealio`, `/wishlist`, `/test-notification` komutlarının çalıştığını ve DM'nin geldiğini doğruladı. |
| Kontrollü DM teslimi | Yeni süre kaydıyla bir test bildirimi 815 ms'de Discord tarafından kabul edildi; kullanıcı tekrar ulaştığını doğruladı. |
| Otomatik tarama | İlk kayıt penceresinde 46 tur, 138 kullanıcı kontrolü; tarama süresi p95 2903 ms. |
| Steam kontrol hatası | 138 kullanıcı kontrolünde bir `STEAM_TIMEOUT` (%0,72); sonraki planlı kontrolde toparlandı. Bu oran HTTP istek hata oranı değildir. |
| Oyun düzeyindeki eksikler | 46 tekrar eden hata, son kayıtlarda tek bir `STEAM_APP_NOT_FOUND` oyununa karşılık geliyor. Yeni Steam isteği de HTTP 200 / `success=false` verdi. Fiyatı bilinmeyen yedi oyun yeni isteklerde `coming_soon=true`, fiyatı olmayan oyunlardı. |
| Kalıcı kuyruk | Bekleyen kuyruk yok, yaş 0 saniye. Bu boş kuyruk sonucudur; yük altındaki teslim kapasitesini kanıtlamaz. |
| Servis ve derleme | VM `ready`, Discord bağlantısı açık; dağıtılan `dist` ağacı test edilen derlemeyle bire bir aynı. |
| Yerel geri dönüş | 29 Eylül tutarlı SQLite yedeği, bütünlük ve yabancı anahtar kontrolleri, yeni kodla izole geri yükleme başarılı. Şema 10. Önceki derleme saklandı. |

İlk canlı pencerenin kodu `4ee867673e988c4b2926b4d4329e4941963afbeb`; ayrı test DM ölçümünün kodu `c5a2f414a298bfc59a5c1fac3570d14fea7639fc`. Kabul belgelerini ekleyen commit bu çalışma kodunu değiştirmez. GitHub `main`, aktif geliştirme kopyası ve VM son kabul commit'ine eşitlenir; son commit CI sonucu ayrıca doğrulanır.

## Tekrar incelenebilir kanıtlar

- [Başlangıç ölçümleri](evidence/stage1/baseline.json)
- [Steam hata ve eksik fiyat incelemesi](evidence/stage1/steam-diagnosis.json)
- [Canlı test DM süresi, servis ve yedek doğrulaması](evidence/stage1/live-dm-probe.json)

Kimliksiz ölçümler kullanıcı, Steam hesabı, Discord mesajı veya token içermez. Test DM ölçümleri `testDeliveries` altında tutulur; gerçek indirim istatistiklerine eklenmez.

## Kod doğrulaması

`npm run typecheck`, `npm run typecheck:handoff`, `npm run build` ve tam `npm test -- --maxWorkers=1` başarılı: 56 dosya / 711 test. GitHub Node 22 ve Node 24 kontrolleri de başarılı. Windows'taki ilk tam çalıştırmada mevcut OpenCode handoff testinde geçici `BACKTO.json` yokluğu oluştu; aynı dosyanın 30 testi ve ardından tam küme yeniden geçti. Bu olay gizlenmedi ve bot kodunda gerekçesiz değişiklik yapılmadı.

## Sonraki aşamalarda doğrulanacak sınırlar

Kontrollü test DM, gerçek Discord taşımasını ölçer; doğal indirim tespitini ve kalıcı kuyrukta beklemeyi kapsamaz. Henüz doğal indirim teslimatı örneği yok, bu ölçümün p95 değeri `null` kalır. Az sayıdaki komut örneği kapasite veya haftalık güvenilirlik iddiası değildir. Eşzamanlı yük, büyük wishlist, kesinti ve kuyruk senaryoları 2. aşamaya aittir.

Uzak yedek, bağımsız alarm, Azure kredi/maliyet doğrulaması, yasal bağlantılar ve geniş masaüstü/mobil kabulü 3–4. aşamalarda tamamlanacaktır. Mevcut yerel yedek uzak felaket kurtarma yedeği sayılmaz. Yedi günlük beta izlemi 4. aşamaya aittir; 1. aşama için yedi günlük kapasite sonucu iddia edilmez. Genel yayın kanıt kapısı henüz geçilmiş değildir.
