# Audit de la synchronisation RUNEDELTA

Audit du 19 septembre 2026, code local au commit `0f91ed5`, version déclarée `1.1.1`.

**Verdict de l’audit initial : ne pas distribuer la version auditée comme une synchronisation fiable pour l’équipe.** Les constats ci-dessous décrivent le code avant correction.

## Corrections réalisées après l’audit

Les points 1 à 6 sont corrigés dans le code local : base de fusion persistée par installation/langue/dépôt, connexion liée au projet, backup obligatoire des catalogues remplacés, reprise des corrections après push refusé et réactivation des actions après annulation d’un conflit. Une synchronisation interrompue entre deux écritures bloque la réutilisation d’une référence ambiguë. Les anciennes connexions demandent une reconnexion explicite ; leur catalogue de jeu reste conservé.

Le mode par défaut édite directement `strings/strings_chapitre_N.json` dans Git. La copie vers `lang/lang_fr.json` est facultative et désactivée par défaut. Les clones de travail sont séparés par installation, langue, chapitre, dépôt et branche ; changer de branche ou de fork conserve les brouillons. La publication utilise la branche choisie.

Un bouton **Récupérer** fusionne les textes dans le fichier local sans commit ni push et fonctionne sans autorisation de publication. Les changements récupérés ne deviennent pas des contributions locales lors d’un changement de chapitre. La configuration GitHub propose une connexion navigateur via GitHub CLI, le contrôle de l’accès Git réel, l’affichage distinct des droits du compte GitHub CLI et la configuration de l’auteur dans le clone uniquement. L’application ne manipule pas de token.

Validation automatisée finale : **142 tests réussis** avec `npm test`. Les régressions couvrent notamment les JSON Git, branches, brouillons, copies facultatives et reprises après échec, ainsi que le parcours GitHub simulé. Les contrôles de syntaxe JavaScript et `git diff --check` passent. Aucun commit ni push sur un dépôt GitHub réel, aucune nouvelle release. Un démarrage Electron isolé et le chargement des branches ont été essayés. Le parcours navigateur d’authentification et l’interface Windows restent à valider. Les essais Computer Use ont été arrêtés à la demande de l’utilisateur avant le changement final de cible de sauvegarde.

Les limites hors de ces corrections demeurent : synchronisation limitée aux textes et différence de compatibilité npm documentée plus bas. Les sections suivantes conservent les constats de l’audit initial, avant correction.

## Vérifications réalisées

- Lecture du module Git, des handlers Electron, du parcours de connexion/publication et de la configuration de distribution.
- Lecture autorisée du dépôt RUNEDELTA sur GitHub. Le dépôt est privé ; les cinq fichiers `strings/strings_chapitre_N.json` existent et passent le validateur de l’application. Ils contiennent respectivement 6 242, 12 660, 12 995, 14 636 et 16 145 clés, avec `date` en premier.
- Suite existante : **105 tests réussis sur 105**, après installation de dépendances dans un répertoire temporaire, avec `NODE_PATH`. La première exécution échouait sur quatre tests faute de `extract-zip` installé sur ce poste.
- Reproductions supplémentaires avec des dépôts Git locaux temporaires, sans accès en écriture au dépôt de l’équipe. Scripts conservés dans `/tmp/deltatranslate-sync-audit.cjs` et `/tmp/deltatranslate-ui-audit.cjs`.
- Aucune validation visuelle ou interactive de l’application : `AGENTS.md`, section 6, demande de faire tester l’application par l’utilisateur. Aucun essai réel de publication GitHub ni de l’installateur Windows.

## Blocages à corriger

### 1. P1 : annulation silencieuse de traductions en changeant de chapitre

Source : `runedelta-sync.js:580`, `runedelta-sync.js:590` et `runedelta-sync.js:624`.

Reproduction : installer les chapitres 4 et 5 ; un autre traducteur modifie une clé du chapitre 5 ; synchroniser le chapitre 4 ; synchroniser ensuite le chapitre 5, sans aucune modification locale.

**Résultat observé : la traduction distante du chapitre 5 est remplacée sur le dépôt distant de test par l’ancien texte anglais. La fonction retourne `ok: true`, sans conflit.**

La fusion Git actualise tous les fichiers du clone, tandis que seul le catalogue du chapitre actif est réécrit dans le jeu. À la synchronisation suivante, `merge-base HEAD origin/...` désigne déjà la nouvelle version distante : l’ancienne copie du jeu est alors interprétée comme une modification volontaire. Une installation ou une autre copie du même chapitre peut provoquer le même décalage.

Correction attendue : conserver une base de synchronisation propre à chaque installation, chapitre et dépôt ; fusionner le catalogue utilisateur à partir de cette base persistée, puis ne l’avancer qu’après écriture réussie. Tester les allers-retours entre chapitres et les contributions simultanées sur la même clé.

### 2. P1 : remplacement sans sauvegarde malgré la promesse affichée

Source : `main.js:85`, `main.js:96`, `main.js:565`, `runedelta-sync.js:503` et `src/app.js:2564`.

La connexion remplace le `lang_fr.json` existant. Le dialogue et le README promettent sa sauvegarde préalable, mais `runedeltaBackup()` ne sauvegarde que si l’option globale Backups est activée. Cette option est désactivée par défaut. Le test ciblé confirme que le callback retourne `null` dans cet état.

Correction attendue : sauvegarde obligatoire avant le remplacement initial d’un catalogue existant, indépendante de la préférence pour les backups courants, ou conservation explicite de l’ancien catalogue dans un emplacement durable avant installation.

### 3. P1 : connexion héritée par une autre installation du même chapitre

Source : `main.js:100`, `main.js:575` et `runedelta-sync.js:711`.

`installedChapters` ne stocke que le numéro du chapitre. Importer une autre installation du chapitre 5 conserve donc son statut connecté, alors que cette installation n’a jamais été rattachée à RUNEDELTA. Le test ciblé retourne `automaticallyEnabled: true`. Cela contredit la garantie du README et permet de proposer à la publication un catalogue indépendant.

Correction attendue : rattacher la connexion à l’identité du projet local, sa langue et son dépôt, et conserver séparément la base de fusion correspondante.

## Défauts fonctionnels supplémentaires

### 4. P2 : faux conflit après un push refusé

Source : `runedelta-sync.js:580` et `runedelta-sync.js:590`.

Reproduction confirmée : publication refusée par un hook du dépôt temporaire ; le premier changement reste commité localement ; corriger cette même ligne puis republier. La deuxième tentative retourne un conflit `phase: local`, bien qu’aucun autre traducteur n’ait modifié la ligne. L’interface oppose même la première version locale à sa correction en présentant celle-ci comme distante.

Correction attendue : distinguer la base du fichier utilisateur de la base Git distante, et tester plusieurs corrections successives hors ligne ou après refus de publication.

### 5. P2 : annuler un conflit laisse les boutons en état occupé

Source : `src/app.js:2607`.

Le statut est redessiné alors que `runedeltaBusy` vaut encore `true`, puis la fonction quitte le bloc et le `finally` remet seulement la variable à `false`. Aucun nouveau rendu ne réactive les boutons. La reproduction isolée confirme `busy: false` mais `lastRenderedBusy: true`.

Correction attendue : actualiser l’interface après avoir libéré l’état occupé, y compris sur annulation.

### 6. P2 : changement de dépôt ou passage à un fork incomplet

Source : `main.js:615` et `runedelta-sync.js:413`.

Déconnecter conserve le dossier et son `origin`. Saisir ensuite une autre URL réutilise ce même clone ; `ensureRepository()` refuse l’URL différente et conseille de déconnecter, action qui ne résout pas le problème. Le passage à un fork annoncé dans le README exige donc actuellement une manipulation Git externe.

Correction attendue : gérer un clone distinct par dépôt ou proposer une migration explicite préservant les commits non publiés.

## Limites importantes pour l’équipe

- **Accès GitHub :** RUNEDELTA étant privé, les membres doivent disposer d’un accès en lecture et d’identifiants Git déjà configurés dès le clone. Git seul ne suffit pas. L’application n’offre pas de connexion GitHub ni de contrôle préalable des droits d’écriture. L’identité de secours générique ne permet pas une attribution fiable à chaque membre.
- **Périmètre synchronisé :** seuls les catalogues JSON sont installés dans le jeu et publiés depuis l’éditeur. Le dépôt comprend aussi des sprites et des polices, téléchargés avec le clone mais sans raccordement automatique aux ressources du chapitre. Les retouches de sprites, de code et les validations de l’éditeur ne sont pas synchronisées par ce module.
- **Récupération seule :** il n’existe pas d’action indépendante pour récupérer les traductions distantes. La récupération est liée à Publier, donc à l’autorisation de publication. Le statut consulte les références Git locales, sans fetch ; « Publié » ne certifie pas que personne n’a contribué depuis la dernière récupération.
- **Reproductibilité de l’installation des dépendances :** `npm ci` échoue sur ce poste avec npm 11.13.0 / Node 24.16.0 : le lockfile ne contient notamment pas `@electron/windows-sign`, `cross-dirname`, `fs-extra@11.4.0`, `postject` et `commander@9.5.0` attendus par la résolution. En revanche, `npm ci --ignore-scripts --dry-run` réussit avec npm 10.9.4. Il s’agit donc d’une différence de compatibilité de l’outillage observée, pas d’une preuve de panne des livrables ou de la CI, qui utilise Node 22. Fixer/documenter la version npm attendue et vérifier une installation complète dans l’environnement de release.

## Conditions de livraison

Corriger d’abord les trois risques de perte ou de mélange de traductions, couvrir les scénarios reproduits par des tests de régression, puis corriger les reprises après échec et l’annulation des conflits. Préparer une notice de connexion GitHub adaptée au dépôt privé et préciser que la synchronisation concerne les textes.

Terminer par un essai utilisateur sur une installation Windows propre, avec deux comptes autorisés et deux chapitres, portant sur la connexion, la récupération, la publication, les conflits, l’annulation et la reprise après refus réseau. Cet essai reste à réaliser et ne doit pas utiliser le travail de traduction réel comme jeu de données de test.
