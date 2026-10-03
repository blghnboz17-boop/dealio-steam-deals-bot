import type { Language } from '../../domain/user-config.js';

interface UiCopy {
  readonly account: string;
  readonly never: string;
  readonly checkingTitle: string;
  readonly checkingDescription: string;
  readonly checkSuccessTitle: string;
  readonly checkUnavailableTitle: string;
  readonly checkFailedTitle: string;
  readonly checkAlreadyTitle: string;
  readonly checkCooldownTitle: string;
  readonly regionTitle: string;
  readonly regionDescription: string;
  readonly regionCountryPlaceholder: string;
  readonly regionOther: string;
  readonly deleteTitle: string;
  readonly deleteDescription: string;
  readonly deleteOpenConfirm: string;
  readonly deleteCancel: string;
  readonly deleteModalTitle: string;
  readonly deleteConsentLabel: string;
  readonly deleteConsentOption: string;
  readonly deleteSuccessTitle: string;
  readonly deleteNoDataTitle: string;
  readonly setupAgain: string;
  readonly testSentTitle: string;
  readonly testFailedTitle: string;
  readonly testCooldownTitle: string;
  readonly testSentDescription: string;
  readonly notSetUpTitle: string;
  readonly detailsUnavailableTitle: string;
  readonly actionFailedTitle: string;
  readonly actionFailedDescription: string;
  readonly panelClosedTitle: string;
}

const copy: Record<Language, UiCopy> = {
  tr: {
    account: 'Hesabın',
    never: 'henüz yok',
    checkingTitle: 'İstek listene bakıyorum',
    checkingDescription: 'Steam\'deki güncel fiyatları tek tek karşılaştırıyorum, birkaç saniye sürebilir.',
    checkSuccessTitle: 'Kontrol bitti',
    checkUnavailableTitle: 'Steam şu an cevap vermiyor',
    checkFailedTitle: 'Kontrolü bitiremedim',
    checkAlreadyTitle: 'Zaten bakıyorum',
    checkCooldownTitle: 'Biraz bekleyelim',
    regionTitle: 'Steam mağaza bölgen',
    regionDescription: 'Fiyatları hangi ülkenin Steam mağazasından göstereyim?',
    regionCountryPlaceholder: 'Ülkeni seç',
    regionOther: 'Listede yok · tüm ülkeler ve arama',
    deleteTitle: 'Dealio verilerini kalıcı olarak sil',
    deleteDescription: 'Steam bağlantın, fiyat geçmişin, oyun kuralların ve bildirim kayıtların silinir. Bu işlem geri alınamaz.',
    deleteOpenConfirm: 'Evet, silmek istiyorum',
    deleteCancel: 'Vazgeç',
    deleteModalTitle: 'Silmeden önce son kez soruyorum',
    deleteConsentLabel: 'Devam etmek için onayla',
    deleteConsentOption: 'Tüm Dealio verilerimin kalıcı olarak silinmesini onaylıyorum',
    deleteSuccessTitle: 'Verilerini sildim',
    deleteNoDataTitle: 'Silinecek bir şey yok',
    setupAgain: 'Yeniden kur',
    testSentTitle: 'Deneme mesajı yolda!',
    testFailedTitle: 'Deneme mesajını gönderemedim',
    testCooldownTitle: 'Biraz bekleyelim',
    testSentDescription: 'DM\'lerine bir bak. Gelen kart, gerçek bildirimlerinin birebir örneği.',
    notSetUpTitle: 'Dealio henüz kurulmadı',
    detailsUnavailableTitle: 'Bilgilerini yükleyemedim',
    actionFailedTitle: 'Bunu tamamlayamadım',
    actionFailedDescription: 'Sonucu gösteremedim. Son durumu görmek için paneli yeniden açabilirsin.',
    panelClosedTitle: 'Panel kapandı',
  },
  en: {
    account: 'Your account',
    never: 'not yet',
    checkingTitle: 'Checking your wishlist',
    checkingDescription: 'I’m comparing today’s Steam prices one by one. This may take a few seconds.',
    checkSuccessTitle: 'All checked',
    checkUnavailableTitle: 'Steam isn’t responding right now',
    checkFailedTitle: 'I couldn’t finish the check',
    checkAlreadyTitle: 'Already on it',
    checkCooldownTitle: 'Just a moment',
    regionTitle: 'Your Steam Store region',
    regionDescription: 'Which country’s Steam Store should I show prices from?',
    regionCountryPlaceholder: 'Choose your country',
    regionOther: 'Not listed · all countries and search',
    deleteTitle: 'Delete your Dealio data for good',
    deleteDescription: 'This deletes your Steam connection, price history, game rules and alert records. It can’t be undone.',
    deleteOpenConfirm: 'Yes, delete my data',
    deleteCancel: 'Cancel',
    deleteModalTitle: 'One last check before deleting',
    deleteConsentLabel: 'Confirm to continue',
    deleteConsentOption: 'I want all my Dealio data permanently deleted',
    deleteSuccessTitle: 'Your data is deleted',
    deleteNoDataTitle: 'Nothing to delete',
    setupAgain: 'Set up again',
    testSentTitle: 'Test message on its way!',
    testFailedTitle: 'I couldn’t send the test message',
    testCooldownTitle: 'Just a moment',
    testSentDescription: 'Check your DMs. The card you got is exactly what your real alerts look like.',
    notSetUpTitle: 'Dealio isn’t set up yet',
    detailsUnavailableTitle: 'Couldn’t load your details',
    actionFailedTitle: 'I couldn’t finish that',
    actionFailedDescription: 'I couldn’t show the result. Reopen the panel to see where things stand.',
    panelClosedTitle: 'Panel closed',
  },
  de: {
    account: 'Dein Konto',
    never: 'noch nicht',
    checkingTitle: 'Ich prüfe deine Wunschliste',
    checkingDescription: 'Ich vergleiche die aktuellen Steam-Preise einzeln. Das kann ein paar Sekunden dauern.',
    checkSuccessTitle: 'Alles geprüft',
    checkUnavailableTitle: 'Steam antwortet gerade nicht',
    checkFailedTitle: 'Ich konnte die Prüfung nicht abschließen',
    checkAlreadyTitle: 'Bin schon dran',
    checkCooldownTitle: 'Einen Moment noch',
    regionTitle: 'Deine Steam-Shop-Region',
    regionDescription: 'Aus welchem Land soll ich dir die Steam-Preise zeigen?',
    regionCountryPlaceholder: 'Wähle dein Land',
    regionOther: 'Nicht dabei · alle Länder und Suche',
    deleteTitle: 'Deine Dealio-Daten endgültig löschen',
    deleteDescription: 'Dabei werden deine Steam-Verbindung, dein Preisverlauf, deine Spielregeln und deine Benachrichtigungen gelöscht. Das lässt sich nicht rückgängig machen.',
    deleteOpenConfirm: 'Ja, Daten löschen',
    deleteCancel: 'Abbrechen',
    deleteModalTitle: 'Letzte Frage vor dem Löschen',
    deleteConsentLabel: 'Zum Fortfahren bestätigen',
    deleteConsentOption: 'Ich möchte alle meine Dealio-Daten endgültig löschen',
    deleteSuccessTitle: 'Deine Daten sind gelöscht',
    deleteNoDataTitle: 'Nichts zu löschen',
    setupAgain: 'Neu einrichten',
    testSentTitle: 'Testnachricht ist unterwegs!',
    testFailedTitle: 'Ich konnte die Testnachricht nicht senden',
    testCooldownTitle: 'Einen Moment noch',
    testSentDescription: 'Schau in deine DMs. Die Karte dort sieht genau so aus wie deine echten Benachrichtigungen.',
    notSetUpTitle: 'Dealio ist noch nicht eingerichtet',
    detailsUnavailableTitle: 'Deine Daten konnten nicht geladen werden',
    actionFailedTitle: 'Das hat nicht geklappt',
    actionFailedDescription: 'Ich konnte das Ergebnis nicht anzeigen. Öffne das Panel neu, um den aktuellen Stand zu sehen.',
    panelClosedTitle: 'Panel geschlossen',
  },
  fr: {
    account: 'Ton compte',
    never: 'pas encore',
    checkingTitle: 'Je vérifie ta liste de souhaits',
    checkingDescription: 'Je compare les prix Steam actuels un par un. Ça peut prendre quelques secondes.',
    checkSuccessTitle: 'Vérification terminée',
    checkUnavailableTitle: 'Steam ne répond pas pour l’instant',
    checkFailedTitle: 'Je n’ai pas pu terminer la vérification',
    checkAlreadyTitle: 'J’y suis déjà',
    checkCooldownTitle: 'Un petit instant',
    regionTitle: 'Ta région Steam',
    regionDescription: 'De quel pays veux-tu voir les prix de la boutique Steam ?',
    regionCountryPlaceholder: 'Choisis ton pays',
    regionOther: 'Pas dans la liste · tous les pays et recherche',
    deleteTitle: 'Supprimer définitivement tes données Dealio',
    deleteDescription: 'Ta connexion Steam, ton historique de prix, tes règles de jeux et tes alertes seront supprimés. C’est irréversible.',
    deleteOpenConfirm: 'Oui, supprimer mes données',
    deleteCancel: 'Annuler',
    deleteModalTitle: 'Dernière vérification avant suppression',
    deleteConsentLabel: 'Confirme pour continuer',
    deleteConsentOption: 'Je veux supprimer définitivement toutes mes données Dealio',
    deleteSuccessTitle: 'Tes données sont supprimées',
    deleteNoDataTitle: 'Rien à supprimer',
    setupAgain: 'Reconfigurer',
    testSentTitle: 'Message de test envoyé !',
    testFailedTitle: 'Je n’ai pas pu envoyer le message de test',
    testCooldownTitle: 'Un petit instant',
    testSentDescription: 'Regarde tes MP. La carte reçue est exactement comme tes vraies alertes.',
    notSetUpTitle: 'Dealio n’est pas encore configuré',
    detailsUnavailableTitle: 'Impossible de charger tes infos',
    actionFailedTitle: 'Ça n’a pas marché',
    actionFailedDescription: 'Je n’ai pas pu afficher le résultat. Rouvre le panneau pour voir où en sont les choses.',
    panelClosedTitle: 'Panneau fermé',
  },
};

export function uiCopy(language: Language): UiCopy {
  return copy[language];
}
