# 2. aşama: güvenilirlik ve kapasite

Başlangıç revizyonu: `cdd3bc24f8eae9460efeec5d0f65a7a81c114906`.
Kapsam: onaylanan yol haritasının ikinci aşaması. Gerçek Steam/Discord'a yük
gönderilmez; geçici SQLite ve kontrollü HTTP/Discord yanıtları kullanılır.

## İş sırası ve kabul

- [x] Belirsiz Discord yanıtı: kalıcı batch kimliğinden sabit nonce; kısa tekrar
  denemesinde tek mesaj, başka batch ve test mesajlarında ayrı kimlik.
- [x] Gerçek servislerle Steam kesintisi, 429, bilinmeyen fiyat ve iyileşme:
  sıfır yanlış indirim; aynı indirim dönemi yeniden aday üretmez.
- [x] Dosya SQLite kapatılıp açıldığında pending/failed/sending korunur;
  eşzamanlı teslim tek claim yapar; DM engeli sonsuz yeniden deneme üretmez.
- [x] 50 kullanıcı × 500 oyun kontrollü kapasite profili; ortak oyunlar
  birleştirilir, Steam eşzamanlı istek sınırı aşılmaz. Süre ve bellek kaydedilir.
- [x] Tür kontrolü, tam test, derleme ve bütün değişikliğin bağımsız incelemesi.

Karar: Discord `enforce_nonce` yalnızca son birkaç dakikayı kapsar.
Kalıcı kuyruk teslimi en az bir kez hedefler; uzun kesinti veya başarılı DM
sonrası veritabanı yazma hatasında mutlak tek teslim garantisi verilemez.
Bu sınır testle görünür tutulacak; bildirimi sessizce kaybetmek için gönderildi
işaretlenmeyecek. Kaynak:
https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx

Ölçüm sınırı: yerel kontrollü süreler gerçek Discord/Steam gecikmesi veya VM
kapasite garantisi değildir. Birinci aşama canlı ölçümleri ayrı tutulur.

## Sonuçlar

### Bulunan ve giderilen darboğazlar

1. Aynı anda biten taramaların SQLite işlemleri olay döngüsünü 11.148 ms
   durdurabiliyordu. `PersistenceWorkQueue` her kullanıcının atomik işlemi
   arasında I/O'ya sıra veriyor; veritabanı transaction'ı içinde await yok.
   Regresyon testi önce 11 aç bırakılmış işlemle başarısız oldu, sonra geçti.
2. Beş kullanıcı × 500 oyun × üç taramada 19 SQL metni 58.621 kez hazırlanıyordu.
   Üç yoğun repository için bağlantı başına en fazla 128 hazırlanan sorgu
   tutuluyor. Daha küçük regresyon profilinde 2.451 hazırlama çağrısı
   200'ün altına indi; durum ve bildirim sayıları korunuyor.
3. Discord'a kalıcı batch kimliğinden 24 karakterlik nonce ve `enforce_nonce`
   gönderiliyor. Test DM'leri farklı kimlik kullanıyor. Bu, uzun kesintiler
   için mutlak tek teslim garantisi değildir; beş dakikalık üretim retry
   süresinde kısa nonce penceresi dolarsa çift DM mümkündür. Bu sınır ayrı
   testle gösterilir; kuyruk gerçekte alınmamış DM'yi gönderildi saymaz.

### Kapasite kanıtı

`npm run test:capacity -- docs/evidence/stage2-capacity.json`

Windows / Node 24.19.0; gerçek SQLite dosyası, gerçek CheckService,
NotificationService, Discord gruplama ve SteamClient; yalnızca dış
taşıyıcılar sentetik. Gönderimden önce üretimdeki yeniden doğrulama callback'i
çalışır; SQLite yeniden açılırken Steam önbelleği temizlenir.

| Ölçüm | Sonuç |
|---|---:|
| Kullanıcı / oyun | 50 × 500 |
| Aday / gönderildi / kayıp | 25.000 / 25.000 / 0 |
| Sentetik DM / normal akışta tekrar | 5.000 / 0 |
| En fazla eşzamanlı Steam isteği | 3 |
| Wishlist / fiyat isteği | 200 / 1.500 |
| İlk tarama / indirim taraması | 463 ms / 928 ms |
| Gönderim + yeniden doğrulama | 81.146 ms |
| Aynı indirimi yeniden tarama | 2.255 ms |
| Olay döngüsü p99 / en uzun gecikme | 71 ms / 165 ms |
| Örneklenen süreç RSS tepe değeri | 250 MiB |

Son kayıt kaynak dosyalarının SHA-256 özetini içerir. `stage2-capacity-before.json`
ve `stage2-capacity-yield-only.json` tanı kayıtlarıdır: bunlarda gönderim öncesi
doğrulama henüz fixture'a bağlı değildi. Bu nedenle süreleri eşdeğer üretim
benchmark'ları gibi değerlendirmeyin. Son profil daha fazla iş yapar.
Ölçüm esnasında yerel test/tür kontrolü süreçleri de çalıştığından değerler
donanımlar arası kesin hız kıyaslaması değildir.

Ek olarak ortak oyunu olmayan 50 × 500 wishlist profili 25.000 ayrı fiyat
isteğini hatasız, en fazla üç eşzamanlı istekle bitirir.

### Güvenilirlik kanıtları

`tests/reliability-resilience.test.ts`:

- Steam 503 / tüm wishlist kesintisi / fiyatı bilinmeyen oyun / 429 ortak bekleme.
- Bekleyen indirimde gönderim öncesi kesinti: göndermez, iyileşince teslim eder.
- 20 eşzamanlı teslim çağrısında tek kuyruk tüketimi.
- Dosya SQLite ile candidate/failed/sending kurtarma; aynı batch kimliği.
- Ayrı Node sürecinin close yapmadan çıkışından sonra kalıcı claim kurtarma.
- Discord kabulü sonrası yanıt kaybı ve receipt yazarken transaction rollback.
- DM engelinde kayıtlı terminal hata; sonsuz yeniden deneme yok.
- Aynı indirim devam ederken kesinti/iyileşme sonrası yeni aday yok.

Bağımsız incelemede fixture'ın üretim revalidate callback'ini atladığı bulundu;
düzeltildi, senaryo eklendi, kapasite yeniden ölçüldü. Hazırlanan sorgu önbelleği
ikinci incelemede bağlama, hata sonrası kullanım ve şema yenilenmesi açısından
kontrol edildi; önemli açık bulgu kalmadı.

### Yayın doğrulaması

Yerel `npm run typecheck`, `npm run typecheck:scenarios`, `npm run build` ve
`npm test -- --maxWorkers=1` başarılı: 57 dosya, 726 test.

[PR #3](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/pull/3)
birleştirildi. Yayın revizyonu `e8df8fb91e43133c8c6c3fccece0a6e5e650c9a7`:
GitHub Node 22/24 tam CI başarılı; VM Node 22.23.2 adayında derleme ve 91 ilgili
test başarılı. Test edilen `dist` ile canlı `dist` bire bir aynı. VM `ready`,
Discord bağlı, bekleyen bildirim 0, yeniden başlama 0. Dağıtım öncesi yerel
SQLite yedeği yeni kodla izole geri yüklenerek doğrulandı; eski derleme saklandı.
Kanıt: [yayın kaydı](evidence/stage2-deployment.json).

Yeni sürümle gerçek menü ve test DM kullanıcı tarafından doğrulandı. DM kabul
süresi 681 ms. İki komutun ilk yanıtları 902 ve 554 ms; başarısız veya üç saniyeyi
aşan ilk yanıt yok. Kullanıcı menünün biraz gecikmeli açıldığını hissettiğini
bildirdi: ilk menü yanıt isteği 796 ms sürdü; bir saniyeyi aşan render/load
uyarısı yok. Tekrarlanan iki açılışın ilk yanıtları 486 ve 368 ms olmasına rağmen
kullanıcı ikinciyi biraz daha yavaş hissetti. Bu nedenle yalnızca ilk yanıt
ölçümüyle sorun kapatılmadı: bir saniyenin altındaki load/render işlemleri ve
ilk panelin Discord tarafından kabul edilmesine kadarki toplam süre ayrı
`discord-ui-metric` kaydına eklendi. Yeni ölçüm ilk yanıt istatistiğine katılmaz;
menü akışını değiştirmez. İstemcinin kendi çizim süresi bu kayıtlarla ölçülemez.
Ek ölçüm değişikliğinde tür kontrolleri ve derleme başarılı; tam paket 57 dosya /
729 test geçti, bağımsız incelemede açık bulgu yok.
Bu kayıt genel kullanıma hazır olma beyanı değildir. Bir haftalık gerçek
kullanıcı ölçümü, uzak yedek ve bağımsız alarm sonraki aşamalardadır.
