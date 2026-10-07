# Genel yayın kontrol listesi

7 Ekim 2026 itibarıyla genel yayını hâlâ engelleyen işler. Bu liste hiçbir kapıyı
geçti saymaz; kabul kayıtlarının sonuçları [phase4-beta.tr.md](phase4-beta.tr.md),
[phase4-beta-results.json](phase4-beta-results.json) ve yayın kapısı kanıt
dosyalarındadır. Genel davet kararı ve davetler yalnız sahibindir.

İşaretler: **[Sahip kanıtı]** gerçek kullanıcı, gerçek cihaz veya gerçek hesapla
yapılması ve kaydedilmesi gereken iş; **[Sahip işlemi]** sahibin yapacağı ayar
veya karar; **[Kod]** kod değişikliği gerektiren iş.

## 1. Gerçek kullanıcı kabulü (4. aşama)

`generalReleaseAccepted: false`. Bekleyen kanıtlar (`pendingEvidence`):

- [ ] **[Sahip kanıtı]** İlk deneme tarihinin netleşmesi (`first-test-date`).
- [ ] **[Sahip kanıtı]** İngilizce istemciyle kurulum ve panel denemesi (`english-client`).
- [ ] **[Sahip kanıtı]** Almanca ve Fransızca gerçek kullanıcı denemesi; README bunların
  henüz denenmediğini söylüyor.
- [ ] **[Sahip kanıtı]** Android denemesi (`android-client`). iOS için tek kişilik
  operatör bildirimi var; mobil kabul sayılmaz.
- [ ] **[Sahip kanıtı]** Sessiz saat ve günlük özetle gerçek zamanlanmış teslim;
  beklenen ve gerçek teslim saati (`scheduled-delivery`). Üretim günlüğünde örnek yok.
- [ ] **[Sahip kanıtı]** Yeterli örnekle aynı teklif için yinelenen DM olmaması
  (`duplicate-prevention`). 6 Ekim veritabanı kontrolü ve sentetik yük testi tek
  başına kabul değildir.
- [ ] **[Sahip kanıtı]** Açıkça onay veren bir gönüllüyle `/delete-data` ve yeniden
  kurulum (`consented-data-deletion`).
- [ ] **[Sahip kanıtı]** Kapalı DM ve erişilemeyen wishlist hatalarının anlaşılır
  olduğu ve düzeltilince takibin sürdüğü.
- [ ] **[Sahip kanıtı]** Hedef fiyat, yüzde kuralı ve susturma senaryoları.
- [ ] **[Sahip kanıtı]** Yanlış indirim veya kaybolan kalıcı bildirim olmadığının
  gözlem süresi boyunca incelenmesi (sıfır toleranslı engel).
- [ ] **[Sahip işlemi]** Yedi günlük gözlem kaydını (7 Ekim, operatör bildirimi +
  üretim günlüğü) kabul için yeterli sayıp saymama kararı. Önemli bir düzeltme
  sonrası gözlem süresinin yeniden başlayıp başlamadığı kayda geçirilir.

## 2. Yayın kapısı (`npm run release:check`)

Yayınlanacak commit'e bağlı, her kapı için ayrı kanıt kaydı ve dosyası gerekir.
Bu kapılar o commit için çalıştırılmadan geçti sayılmaz:

- [ ] **[Sahip kanıtı]** `testBotDesktop`: ayrı test uygulamasıyla masaüstü kabulü.
- [ ] **[Sahip kanıtı]** `testBotMobile`: ayrı test uygulamasıyla mobil kabul.
- [ ] **[Sahip kanıtı]** `restoreRehearsal`: o commit için uzak yedekten geri yükleme.
- [ ] **[Sahip kanıtı]** `independentAlarm`: Healthchecks alarmının gerçekten tetiklenmesi.
- [ ] **[Sahip kanıtı]** `cleanInstall`: temiz kurulum.
- [ ] **[Sahip kanıtı]** `azureCreditVerified`: Azure for Students kredisi ve aylık
  maliyetin doğrulanması (kredi 7 Eylül 2027'de biter).
- [ ] **[Sahip işlemi]** `termsUrl`, `privacyUrl`, `supportUrl` HTTPS üzerinden açılıyor.

## 3. Yasal sayfalar ve Discord uygulaması

- [ ] **[Sahip işlemi]** Bu daldaki 7 Ekim 2026 tarihli gizlilik politikası ve
  koşullar `main`'e birleşince `Publish public Dealio pages` iş akışını elle
  çalıştır; canlı sayfada tarihi kontrol et.
- [ ] **[Sahip işlemi]** Discord Developer Portal'daki Terms of Service ve Privacy
  Policy URL'lerinin yayımlanan sayfalara gittiğini doğrula.
- [ ] **[Sahip işlemi]** Politikadaki önemli değişikliğin mevcut beta kullanıcılarına
  duyurulup duyurulmayacağına karar ver. Ajan kullanıcılara kendiliğinden mesaj göndermez.
- [ ] **[Sahip işlemi]** Bot 100 sunucuya yaklaşmadan Discord uygulama doğrulamasını
  başlat; Discord doğrulanmamış botların 100'den fazla sunucuya eklenmesine izin vermez.
- [ ] **[Sahip işlemi]** Destek yolu: sitede yalnız e-posta var. Genel yayında yanıt
  süresi ve kanal (ör. destek sunucusu) belirlenmeli.

## 4. Kapasite ve işletim

- [ ] **[Sahip işlemi]** `DEALIO_MAX_USERS` (varsayılan 200) genel yayında ne olacak?
  200 kullanıcılık sentetik ölçüm var
  ([capacity-2026-10-07-200-users.json](evidence/capacity-2026-10-07-200-users.json));
  daha yüksek sınır 1 GiB VM'de yeni ölçüm ister.
- [ ] **[Sahip kanıtı]** Genel yayın sonrası ilk hafta için ilk yanıt, tarama, Steam
  hata oranı ve DM gecikmesinin yeniden ölçülmesi (`npm run metrics:report`).

## 5. Yayından önce kod değişikliği isteyen bulgular

Gizlilik politikası bunları bugünkü davranışla açıklıyor; düzeltilince politika da
güncellenmeli.

- [x] **[Kod, düzeltildi]** `deploy/switch-release.sh` her sürümde VM'de
  `~/dealio-backups/<tarih>-<sha>/wishlist.db` ve `restore-test.db` bırakıyor ve
  bunları hiç silmiyor. Silme günlüğü 35 gün sonra temizlendiği için daha eski bir
  kopyadan geri dönüş silinmiş kullanıcıyı geri getirebilir. Otomatik temizlik
  (ör. 7 gün) eklenmeli. Artık başarılı her geçişte 7 günden eski kopyalar
  siliniyor; politika güncellendi. Sürüm çıkmazsa eski kopyalar bir sonraki sürüme
  kadar kalır.
- [x] **[Kod, düzeltildi]** `/delete-data`, doğrudan mesajın `broadcast.audience` alanındaki
  alıcı kimliğini (90 gün) ve `admin_audit.target` satırlarını (1 yıl) silmiyor.
  Artık yalnız o kişiye giden mesaj siliniyor, diğer kitlelerden kimlik çıkarılıyor
  ve denetim kaydındaki kimlik hash ile değiştiriliyor; politika güncellendi.
- [x] **[Kod, düzeltildi]** Kurulumu olmayan biri `/delete-data` çalıştırınca kullanım kayıtları
  siliniyor ama ekran “veri bulunamadı” diyor ve silme günlüğüne kayıt yazılmıyor;
  yedekten dönüşte bu kayıtlar geri gelebilir. Artık her silme günlüğe yazılıyor
  ve ekran kalan kullanım kayıtlarının da silindiğini söylüyor.
- [ ] **[Kod]** VM'in genel IP adresi `scripts/admin-tunnel.ps1` ve `deploy/*.md`
  içinde yazılı. Depo özel olduğu sürece sorun değil; depo açılacaksa çıkarılmalı.
