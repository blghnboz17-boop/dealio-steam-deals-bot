<p align="center">
  <img src="docs/assets/dealio-onboarding-banner.png" alt="Dealio — koyu zemin üzerinde mavi fiyat etiketi ve kalp" width="960">
</p>

<h1 align="center">Wishlist’in. Senin kuralların.</h1>

<p align="center">
  Discord içindeki kişisel Steam fiyat asistanın.<br>
  Fiyatını seç. Bildirim zamanını belirle. Fırsatı bilgisiyle birlikte gör.
</p>

<p align="center">
  <strong>Sınırlı beta</strong> &nbsp;·&nbsp; Ücretsiz kullanım &nbsp;·&nbsp; Yalnızca Steam &nbsp;·&nbsp; Türkçe &amp; English
</p>

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1540325119690412172&amp;integration_type=0&amp;scope=bot%20applications.commands&amp;permissions=0"><strong>Dealio’yu Discord’da dene →</strong></a>
  &nbsp;&nbsp; <a href="README.md">English</a>
  &nbsp;&nbsp; <a href="#komutlar">Komutlar</a>
  &nbsp;&nbsp; <a href="#beta-durumu">Beta durumu</a>
</p>

---

## Daha az kontrol. Daha çok seçim.

Dealio, herkese açık Steam wishlist’ini takip eder ve kurallarına uyan fırsatları DM ile iletir. Oyun görsellerini incele, hedef fiyat belirle ve fiyatın ne zaman gözlemlendiğini sana özel Discord panelinde gör.

| Senin fiyatın | Senin zamanın | Fiyatın geçmişi |
| :--- | :--- | :--- |
| Her oyun için hedef fiyat veya indirim eşiği belirle. Bildirim istemediğin oyunu sustur. | Tespit edilince bildirim al, sessiz saatler seç veya günlük özete geç. | Steam’in bölgesel para birimini, gözlemlenen fiyatları ve bildirimin neden geldiğini incele. |

### Dealio’da neler var?

- **Kişisel ana ekran.** Öne çıkan oyun görseli, gözlemlenen fiyatlar, kurallarına uygun fırsatlar ve wishlist, bildirim zamanı, geçmiş bağlantıları.
- **Kullanışlı wishlist.** Sayfa başına üç kompakt oyun kartı, isimle arama, uygun fırsatlar filtresi ve her oyun için detay ekranı.
- **Sana ait kurallar.** Oyun genel indirim eşiğini kullanabilir; kendi yüzdesi veya Steam para biriminde hedef fiyatı olabilir. Susturma ayrıca uygulanır.
- **Teslimat kaydı.** Bekleyen, iletilen, engellenen ve geçerliliğini kaybeden bildirimler; DM erişimini deneme seçeneği. “Discord’a iletildi”, “okundu” demek değildir.
- **Gerçek gözlemlerden fiyat geçmişi.** Dealio’nun son 90 günlük kayıtları. Yeni oyunlarda veri az olabilir; bu, tüm zamanların en düşük fiyatları arşivi değildir.
- **İki dil.** Kurulumdan bildirimlere kadar Türkçe ve İngilizce paneller.

## Discord’da başla

1. **[Dealio’yu sunucuna ekle](https://discord.com/oauth2/authorize?client_id=1540325119690412172&integration_type=0&scope=bot%20applications.commands&permissions=0).** Yönetici izni istenmez.
2. **`/setup` yaz.** SteamID64 veya profil bağlantını gir; gerçek Steam Store ülkeni ve dilini doğrula, ardından indirim DM’lerini açıkça onayla.
3. **`/dealio` aç.** Wishlist’ini incele, bir oyun seç ve istediğin fiyatı belirle.

Steam wishlist’in herkese açık olmalı; Discord, bottan DM almana izin vermeli. Dealio Steam şifreni, çerezlerini veya giriş oturumunu istemez.

## Bildirimler nasıl çalışır?

**Kontroller 30 dakikalık düzende yapılır; Steam’den anlık olay akışı alınmaz.** Bir sonraki otomatik tarama, önceki tarama bittikten 30 dakika sonrasına planlanır. Steam veya Discord kesintileri gecikme yaratabilir.

| Adım | Ne olur? |
| :--- | :--- |
| Gözlemle | Seçtiğin ülke ve dil için Steam fiyatları alınır. Başarılı oyun fiyatı sorguları beş dakikalık ortak önbelleği kullanır; gerçek gözlem zamanı korunur. |
| Karşılaştır | Oyunun hedef fiyatı veya indirim kuralı değerlendirilir. Alınamayan fiyat, fırsat olarak yorumlanmaz. |
| Gerekirse beklet | Sessiz saatler, günlük özet veya teslimat tekrarları için uygun bildirimler kalıcı kuyrukta tutulur. |
| Doğrula ve ilet | Gönderim öncesi bekleyen fırsatların fiyatı tekrar kontrol edilir. Bittiği doğrulanan teklif gönderilmez. |

Kurulum başlangıç durumunu kaydeder ve ayrıca bir wishlist özeti gönderebilir. Zaten indirimdeki her oyun için ayrı yeni-indirim bildirimi oluşturmaz. Mevcut fiyatın zaten karşıladığı bir hedefi kaydetmek de başlangıç bildirimi üretmez.

Fiyatlar Steam’in bildirdiği para biriminde kalır; tahmini kur dönüşümü yapılmaz. Hedef fiyat para birimine bağlıdır; ülke/para birimi değişince yeni hedef gerekebilir. Satın almadan önce Steam’deki ödeme fiyatını doğrula.

## Komutlar

| Komut | İşlev |
| :--- | :--- |
| `/dealio` | Ana ekran: fırsatlar, takip ve kişisel kontroller |
| `/setup` | Steam profilini bağla, tercihlerini belirle |
| `/wishlist` | Oyun ara, hedef belirle, sustur ve fiyat gözlemlerini incele |
| `/status` | Hesap, genel indirim eşiği ve bildirim durumu |
| `/check` | Kısa bekleme sınırına tabi olarak kontrol iste |
| `/region` | Steam Store ülkeni seç |
| `/test-notification` | Kendine örnek bildirim gönder |
| `/delete-data` | Onayından sonra aktif hesap verilerini sil |

Paneller sana özeldir; düğmeler paneli açan kullanıcıya bağlıdır. Süre dolunca veya bot yeniden başlayınca yeni bir komut açarak devam edebilirsin.

## Beta durumu

**Mevcut aşama: Azure’daki mevcut sunucuda sınırlı beta.** Temel asistan çalışıyor. 12 Eylül 2026’da 648 otomatik test ve Node.js 22/24 GitHub kontrolleri geçti; proje sahibi manuel kontrol listesinin çalışıyor göründüğünü bildirdi. Bu geri bildirim, bütün cihazların ve uzun süreli teslimat senaryolarının belgelenmiş kabulü anlamına gelmez.

Herkese açık beta duyurusundan önce:

- [ ] Erişilebilir gizlilik, koşullar ve yardım sayfalarını yayımla; Discord uygulamasındaki bağlantıları güncelle.
- [ ] Ek kaynak açmadan önce Azure kredi kapsamını doğrula.
- [ ] Uzak yedeği etkinleştir, geri yükleme provası yap ve bağımsız operasyon alarmını dene.
- [ ] Dağıtık uygulama kilidini doğrula; masaüstü/mobil ve zamanlı bildirim kabulünü kaydet.

Mevcut kurulumda belirli sunucuya bağlı başlangıç kontrolü, uygulama kilidi ve yerel geri dönüş yedeği var. Bulut kilidi, yedek, izleme ve site yayını için kod hazır; bu dış hizmetler **henüz kurulmadı**.

[Geçiş kanıtı ve kalan işler →](deploy/IMPLEMENTATION-STATUS.tr.md)

## Verilerin ve kontrolün

Dealio hesap kimliklerini, tercihlerini, oyun kurallarını, gözlemlenen wishlist fiyatlarını ve teslimat kayıtlarını tutar. Normal Discord mesajlarının içeriğini veya Steam giriş bilgilerini toplamaz.

Bildirim geçmişi son **30 günü** gösterir; fiyat gözlemleri **90 gün** tutulur. Aktif teslimat ve devam eden tekliflerin tekrarını önleyen kayıtlar daha uzun kalabilir. `/delete-data` aktif hesap kayıtlarını siler; mevcut yedek kopyaları bu komutla yeniden yazılmaz.

Politika kaynakları repoda bulunur: [gizlilik](docs/privacy-tr.html) · [koşullar](docs/terms-tr.html). Herkese erişilebilir politika bağlantıları hâlâ yayın ön koşuludur.

## Sık sorulanlar

<details>
<summary><strong>Hedef belirledim. Neden hemen DM gelmedi?</strong></summary>

Kural kaydı başlangıç durumunu belirler. Zaten uygun olan teklif panelde gösterilir; bildirim, daha sonraki uygun geçişi bekler. Oyunun kuralını, susturma durumunu ve bildirim zamanını kontrol et.

</details>

<details>
<summary><strong>Kurulumumu silmeden bildirimleri durdurabilir miyim?</strong></summary>

Evet. `/status` içindeki bildirim düğmesini kullan. Ayarların korunur. Otomatik bildirimler kapalıyken manuel `/check` çalışmaya devam eder.

</details>

<details>
<summary><strong>Aynı bildirim iki kez gelebilir mi?</strong></summary>

Kalıcı tekilleştirme aynı teklifin rutin olarak tekrar gönderilmesini önler. Discord mesajı kabul ettiği hâlde teyidi kaybolursa, yeniden deneme çift mesaj üretebilir. Tam olarak bir kez teslim garantisi verilmez.

</details>

## Geliştirme ve işletim

TypeScript · discord.js Components V2 · SQLite · Azure VM

- [Geliştirme rehberi](docs/development.md) — ayrı test kurulumu, ayarlar ve kontroller
- [Mimari](docs/architecture.md) — fiyatlar, kurallar, teslimat ve veri
- [Azure işletimi](deploy/azure/README.tr.md) — yayın ön koşulları ve kurtarma
- [GitHub kontrolleri](https://github.com/blghnboz17-boop/steam-wishlist-discord-bot/actions/workflows/ci.yml) — güncel doğrulamalar

İlk sürüm Steam wishlist’lerine odaklanır. Ödeme sistemi, ayrı web yönetim paneli, diğer mağazalar ve tahmini para birimi dönüşümü kapsam dışındadır.

---

<p align="center">
  <a href="https://github.com/blghnboz17-boop">Bilgehan</a> tarafından geliştirildi · <a href="LICENSE">MIT lisansı</a> · Kaynak repo özeldir.<br>
  <sub>Dealio bağımsız bir projedir; Valve veya Discord ile bağlantılı değildir.</sub>
</p>
