# Dealio yönetim paneli

Bot sahibine özel web paneli. Bot sürecinin içinde çalışır, yalnız
`127.0.0.1` adresini dinler ve SSH tüneliyle açılır. İnternete port açılmaz,
ek bulut kaynağı gerekmez.

## Kurulum

1. Uzun, rastgele bir anahtar üretin:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. VM'deki `.env` dosyasına ekleyin (paylaşmayın, commit etmeyin):

   ```env
   DEALIO_ADMIN_TOKEN=<üretilen anahtar>
   DEALIO_ADMIN_PORT=8787
   ```

3. Servisi yeniden başlatın: `sudo systemctl restart dealio`. Günlükte
   `Admin panel listening on 127.0.0.1:8787` satırı görünür.
   `ss -ltnp | grep 8787` yalnız `127.0.0.1:8787` göstermelidir.

`DEALIO_ADMIN_TOKEN` boşsa panel hiç başlamaz. Panel başlayamazsa (ör. port dolu)
bot çalışmaya devam eder; yalnız günlüğe hata yazılır.

## Açma

Windows'ta:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/admin-tunnel.ps1
```

Betik `ssh -N -L 127.0.0.1:8787:127.0.0.1:8787 dealiobot@20.240.162.55` tünelini
açar ve tarayıcıda `http://localhost:8787` adresini başlatır. Masaüstündeki
**Dealio Yönetim** kısayolu aynı betiği çalıştırır; pencereyi kapatmak tüneli kapatır.

Anahtar `%USERPROFILE%\.dealiodmin-token` dosyasındaysa panel giriş yapmış
olarak açılır: anahtar URL'nin `#` kısmında taşınır (sunucuya gönderilmez) ve
sayfa onu adres çubuğundan ve geçmişten hemen siler. Dosya yoksa giriş ekranına
`DEALIO_ADMIN_TOKEN` değerini yazın. Oturum 12 saat sürer, bot yeniden başlayınca
kapanır.

Yerel geliştirmede (`.env.test` ile) tünel gerekmez; doğrudan
`http://localhost:8787` açılır. Sentetik verili önizleme için:
`npm run preview:admin` (Discord'a hiçbir şey göndermez).

## Ekranlar

| Sayfa | İçerik |
|---|---|
| Genel bakış | Sunucu/kullanıcı/aktif kullanıcı sayıları, kapasite, uyarı kuyruğu, günlük kayıt, uyarı, aktif kullanıcı ve sunucu grafikleri, dağılımlar |
| Sunucular | Botun olduğu sunucular (canlı), sahipleri, Dealio kullanan kişi sayısı; olay geçmişi, ayrılan ve engellenen sunucular. Detayda o sunucudan gelen kullanıcılar, **sunucudan çık** ve **engelle** |
| Kullanıcılar | Arama, filtre, CSV; geldiği sunucu, son görülme. Detayda wishlist, kurallar, bildirim geçmişi, kullanım zaman çizelgesi ve işlemler |
| Oyunlar | En çok istenen, şu an indirimde, en çok uyarı ve kural konan oyunlar |
| Kullanım | Günlük aktif kullanıcı, eylemler, kurulum hunisi ve başarısızlık sebepleri, kurulum türü, kaynak sunucular |
| Duyurular | Dört dilde duyuru yazma, Discord önizlemesi, hedef kitle, gönderim takibi, duraklat/sürdür/iptal |
| Sistem | Sağlık, süreç, veritabanı, tarayıcı; **şimdi tara**, **bildirimleri şimdi dene**; kayıtları aç/kapat, kullanıcı sınırı, bot durum metni; engellenen kullanıcılar |
| Denetim | Panelden yapılan tüm işlemler (1 yıl) |
| Loglar | Bot sürecinin son 1000 satırı, canlı akış |

## Kullanıcı işlemleri

İzlemeyi durdur/aç (açmak DM engelini de temizler), şimdi kontrol et, test
uyarısı, DM gönder, bölge ve dil değiştir, engelle/engeli kaldır, verileri sil.
Hepsi Discord komutlarıyla aynı servislerden ve kullanıcı başına kilitten geçer.
Veri silme `/delete-data` ile aynıdır ve silme günlüğüne yazılır.

Engellenen hesap Dealio'nun komut ve düğmelerini kullanamaz; yalnız
`/delete-data` açık kalır. Engelli sunucuya eklenen bot hemen çıkar.

## Duyurular ve DM

- Yalnız kurulumu tamamlamış (DM onayı vermiş), engellenmemiş ve DM'i kapalı
  olmayan kullanıcılar alıcıdır.
- Alıcılar Discord çağrısından önce veritabanına yazılır; her deneme öncesinde
  `sending` olarak işaretlenir. Teslim en az bir kez garantilidir (yeniden
  başlatmada yarım kalan gönderim tekrar denenir).
- Hız: 1,5 saniyede bir mesaj. Discord hız sınırı deneme hakkı harcamaz;
  50007 (DM kapalı) kullanıcının DM engelini işaretler.
- Kullanıcı kendi dilini, yoksa İngilizceyi, o da yoksa yazılan başka bir dili görür.
- Toplu duyuruyu başlatmak için onay kutusuna `GÖNDER` yazılır. Duyuruları
  servisle ilgili ve seyrek tutun; Discord istenmeyen toplu DM'leri spam sayabilir.

## Toplanan kullanım verisi

Gizlilik politikasında (`docs/privacy*.html`, 6 Ekim 2026) açıklandığı gibi:

- `interaction_event`: kullanıcı, sunucu (DM'de boş), bağlam, kurulum türü,
  komut/düğme adı (girdi metni değil), Discord dili, zaman. 90 gün.
- `guild_event`: botun eklendiği/çıkarıldığı sunucu, ad, üye sayısı, zaman.
- `admin_audit`: panel işlemleri, 1 yıl.
- `broadcast`, `broadcast_recipient`: duyurular ve teslim durumu, 90 gün.
- `user_block`, `guild_block`, `runtime_setting`.

`/delete-data` kullanım ve teslim kayıtlarını da siler; silme günlüğü yedekten
dönen eski kullanım kayıtlarını da temizler. Engel kaydı korunur.

## Güvenlik

- Yalnız `127.0.0.1`; `Host` başlığı localhost değilse 421 (DNS rebinding).
- Tek anahtar, sabit-zamanlı karşılaştırma; 15 dakikada 10 hatalı denemede kilit.
- `HttpOnly; SameSite=Strict` oturum çerezi, her değişiklikte CSRF başlığı ve
  `Origin` kontrolü; yıkıcı işlemler hedef kimliğin yazılmasını ister.
- Sıkı CSP (satır içi betik yok), `X-Frame-Options: DENY`, `nosniff`.
- Anahtar günlüğe yazılmaz; log görünümü `redactSecrets` ile maskelenir.
- Discord profilleri bellekte önbelleklenir, veritabanına yazılmaz.
