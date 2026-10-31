import type { ArticleInput } from "./articles.ts";

// Help articles of the demonstration projects, all fictitious. They are the articles of the
// measure of decision 010. Loaded with `pnpm kb:import --demo`.
export const demoArticles: ArticleInput[] = [
  {
    projectKey: "PORTAL",
    source: "demo/portal-users",
    title: "Ajouter un utilisateur au portail",
    body: "Un administrateur du client ouvre Administration > Comptes, choisit « Inviter un compte », saisit l'adresse e-mail de la personne et son rôle (lecteur, gestionnaire ou administrateur). La personne reçoit une invitation valable 72 heures. Une invitation expirée peut être renvoyée depuis la même page.",
  },
  {
    projectKey: "PORTAL",
    source: "demo/portal-password",
    title: "Réinitialiser un mot de passe",
    body: "Sur la page de connexion, le lien « Mot de passe oublié » envoie un e-mail de réinitialisation valable 30 minutes. Un administrateur peut aussi forcer la réinitialisation depuis Administration > Comptes, bouton « Réinitialiser l'accès ». Si l'e-mail n'arrive pas, vérifier le dossier des indésirables puis l'adresse enregistrée sur le compte.",
  },
  {
    projectKey: "PORTAL",
    source: "demo/portal-invoices",
    title: "Télécharger ses factures",
    body: "Les factures sont disponibles dans Facturation > Mes factures, au format PDF, dès le 2 du mois suivant. Les factures des 24 derniers mois sont conservées en ligne ; les plus anciennes sont envoyées sur demande au support.",
  },
  {
    projectKey: "PORTAL",
    source: "demo/portal-sso",
    title: "Connexion avec le compte de l'entreprise (SSO)",
    body: "Le portail accepte la connexion unique SAML 2.0. L'administrateur du client fournit les métadonnées de son fournisseur d'identité ; l'activation prend effet sous un jour ouvré après validation par l'équipe. Une fois le SSO actif, les mots de passe locaux sont désactivés, sauf pour un compte de secours.",
  },
  {
    projectKey: "PORTAL",
    source: "demo/portal-hours",
    title: "Horaires du support",
    body: "Le support du portail répond du lundi au vendredi, de 9 h à 18 h, heure de Paris, hors jours fériés. Les incidents critiques signalés en dehors de ces horaires sont pris en compte le jour ouvré suivant.",
  },
  {
    projectKey: "SHOP",
    source: "demo/shop-refund",
    title: "Rembourser une commande",
    body: "Dans l'administration de la boutique, ouvrir Commandes, choisir la commande puis « Rembourser ». Le remboursement peut être total ou partiel ; il arrive sur le moyen de paiement du client sous 5 à 10 jours ouvrés.",
  },
  {
    projectKey: "SHOP",
    source: "demo/shop-promo",
    title: "Créer un code promo",
    body: "Marketing > Codes promo > Nouveau code. Choisir un pourcentage ou un montant fixe, une date de fin et, si besoin, un nombre maximal d'utilisations. Un code ne se cumule pas avec un autre.",
  },
  {
    projectKey: "SHOP",
    source: "demo/shop-stock",
    title: "Alerte de stock bas",
    body: "Chaque produit a un seuil d'alerte, réglable dans la fiche produit, onglet Stock. Sous ce seuil, un e-mail est envoyé chaque matin aux gestionnaires de la boutique.",
  },
  {
    projectKey: "CRM",
    source: "demo/crm-import",
    title: "Importer des contacts",
    body: "Contacts > Importer accepte un fichier CSV encodé en UTF-8, avec une ligne d'en-tête. Les colonnes obligatoires sont nom et e-mail. Un import de plus de 10 000 lignes est traité en arrière-plan et un e-mail prévient à la fin.",
  },
  {
    projectKey: "CRM",
    source: "demo/crm-pipeline",
    title: "Modifier les étapes du pipeline",
    body: "Paramètres > Ventes > Étapes du pipeline permet d'ajouter, renommer ou réordonner les étapes. Une étape qui contient des opportunités ne peut pas être supprimée : il faut d'abord déplacer ses opportunités.",
  },
];
