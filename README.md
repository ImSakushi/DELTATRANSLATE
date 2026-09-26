<div align="center">
  <img src="src/assets/deltatranslate-icon.png" alt="Icône DELTATRANSLATE" width="112">
  <br>
  <img src="src/assets/deltatranslate-wordmark.png" alt="DELTATRANSLATE" width="620">

  <p><strong>L’éditeur de traduction DELTARUNE avec aperçu fidèle au moteur du jeu.</strong></p>

  <p>
    <img alt="Version 1.2.1" src="https://img.shields.io/badge/version-1.2.1-20d9e8?style=flat-square">
    <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-47848f?style=flat-square&logo=electron&logoColor=white">
    <img alt="Windows, macOS et Linux" src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-111827?style=flat-square">
    <img alt="Aucune donnée du jeu incluse" src="https://img.shields.io/badge/données%20du%20jeu-non%20incluses-3fb950?style=flat-square">
  </p>
</div>

DELTATRANSLATE est une application de bureau conçue pour traduire les textes de **DELTARUNE** de l’anglais vers la langue de votre choix. Elle associe un éditeur rapide à une prévisualisation en temps réel des textbox : polices bitmap, portraits, couleurs, retours à la ligne, boîtes de dialogue et bulles de combat.

> [!IMPORTANT]
> DELTATRANSLATE ne distribue aucune donnée de DELTARUNE. Vous devez posséder votre propre copie du jeu et importer le `data.win` du chapitre que vous souhaitez traduire. Toutes les ressources nécessaires sont extraites localement.

## Sommaire

- [Pourquoi DELTATRANSLATE ?](#pourquoi-deltatranslate-)
- [Installation](#installation)
- [Premier démarrage](#premier-démarrage)
- [Fonctionnalités](#fonctionnalités)
- [Travailler avec Runedelta](#travailler-avec-runedelta)
- [Sauvegarde et sécurité](#sauvegarde-et-sécurité)
- [Raccourcis et codes de contrôle](#raccourcis-et-codes-de-contrôle)
- [Données locales et confidentialité](#données-locales-et-confidentialité)
- [Développement](#développement)
- [Dépannage](#dépannage)

## Pourquoi DELTATRANSLATE ?

Traduire une ligne sans la voir dans sa textbox réelle rend les problèmes de longueur, de rythme ou de portrait difficiles à détecter. DELTATRANSLATE reconstruit le comportement du writer GameMaker à partir du code du jeu afin de montrer le résultat avant même de le lancer.

| Besoin | Réponse de DELTATRANSLATE |
| --- | --- |
| Retrouver rapidement un texte | Recherche dans l’anglais, le français et les clés, avec ou sans codes de contrôle |
| Conserver le contexte | Regroupement des lignes voisines et décor de room associé quand il peut être déterminé |
| Éviter les débordements | Compteurs de colonnes et word-wrap reproduisant les règles du jeu |
| Contrôler le rendu | Prévisualisation des portraits, expressions, couleurs, styles et modes de textbox |
| Suivre l’avancement | Filtre **À traduire** et validation **OK tel quel** pour les textes volontairement identiques |
| Protéger le travail | Copies de sauvegarde horodatées et écriture sécurisée dans la cible active |

## Installation

### Version prête à utiliser (recommandé)

Téléchargez DELTATRANSLATE depuis la [page des versions](https://github.com/ImSakushi/DELTATRANSLATE/releases/latest).

| Système | Fichier à choisir | Installation |
| --- | --- | --- |
| Windows | `DELTATRANSLATE-Setup-…-Windows-x64.exe` | Double-cliquez : l’application s’installe pour votre compte et s’ouvre automatiquement. |
| macOS | `DELTATRANSLATE-…-macOS-universal.dmg` | Ouvrez l’image et glissez l’application dans Applications. |
| Linux | `DELTATRANSLATE-…-Linux-x64.AppImage` ou `.deb` | Autorisez l’exécution de l’AppImage, ou installez le paquet DEB. |

La version Windows **Portable** permet aussi de lancer l’application sans installation.
Il vous faut seulement une copie installée de DELTARUNE et une connexion Internet si l’outil de lecture
du jeu doit être téléchargé. **Ni Node.js ni Git ne sont nécessaires pour traduire avec la version distribuée.**
L’édition **1.2.1 — Git intégré** inclut Git et GitHub CLI pour Runedelta sur Windows, macOS et Linux. Aucune installation supplémentaire de ces outils n’est nécessaire.

### Depuis le dépôt

Cette option s’adresse au développement et nécessite Node.js avec npm ainsi que Git pour cloner le dépôt.

```bash
git clone https://github.com/ImSakushi/DELTATRANSLATE.git
cd DELTATRANSLATE
npm install
npm run prepare:tools
npm start
```

L’application utilise UndertaleModTool CLI pour lire les données du jeu. Il est installé automatiquement
lors de la préparation du premier chapitre si nécessaire. Une installation existante peut être liée depuis
**Options avancées**, notamment pour travailler hors ligne.

Les versions distribuées vérifient les releases stables du dépôt **ImSakushi/DELTATRANSLATE** à chaque démarrage et à la réouverture de la fenêtre, puis toutes les quatre heures. Une fenêtre signale toute nouvelle version ; le choix « Plus tard » ne masque pas cette notification lors du prochain démarrage. Le bouton **↻ Mises à jour** permet aussi de vérifier à tout moment. Une version strictement supérieure est proposée : **Télécharger et mettre à jour** lance son téléchargement avec progression, puis **Installer et redémarrer** sauvegarde les traductions, les overrides GML et les préférences avant de lancer l’installation et de rouvrir l’application. Rien n’est téléchargé ni installé sans votre action, même à la fermeture. **Plus tard** conserve l’accès à la mise à jour depuis le bouton ; une erreur permet de réessayer.

Sur Windows Portable, la mise à jour utilise le Setup : elle installe l’application pour votre compte et crée un raccourci à utiliser ensuite. Les données locales restent conservées ; l’ancien exécutable portable reste sur le disque. Sur macOS, l’installation intégrée nécessite une application signée : les builds actuels non signés signalent la nouvelle version et ouvrent la page de téléchargement pour remplacer l’application depuis le DMG. Le même signalement reste disponible si l’updater natif est désactivé. Les lancements depuis le code source avec `npm start` ne déclenchent pas de mise à jour.

Republier une release sous le même numéro ne constitue pas une version supérieure : une installation existante doit télécharger la reconstruction portant le même numéro depuis GitHub pour recevoir les correctifs.

## Premier démarrage

1. Ouvrez DELTATRANSLATE et choisissez un chapitre parmi ceux détectés dans Steam.
   Si le jeu n’est pas trouvé, cliquez sur **Choisir le dossier du jeu…**, ou déposez le `data.win` du chapitre.
2. Choisissez la langue à ajouter : français, espagnol, allemand, ou **Autre langue…** avec son code.
   Pour les accents, utilisez **Choisir les polices d’un mod existant…** et sélectionnez le `data.win` du mod donneur.
   Les polices compatibles seront copiées uniquement dans les ressources de cette langue.
3. Fermez le jeu, puis cliquez sur **Préparer ce chapitre**. DELTATRANSLATE installe UTMT si nécessaire,
   extrait les ressources et prépare le sélecteur de langues sur une copie du jeu. Le résultat est recompilé,
   rechargé et vérifié avant installation avec sauvegarde. Les étapes et le temps écoulé restent visibles.
4. Cliquez sur **Commencer à traduire →**. Sélectionnez une ligne, saisissez sa traduction et contrôlez son aperçu.

Enregistrez avec `Ctrl+S` (ou `⌘S` sur Mac). L’écran de fin de préparation indique la cible de sauvegarde.
Les lancements suivants ouvrent directement le chapitre configuré. Un échec de préparation permet de
réessayer sans recommencer un téléchargement d’UTMT déjà terminé ; le journal est disponible dans **Détails de la préparation**.

Runedelta et la publication GitHub sont désactivés par défaut, y compris pour une ancienne configuration.
Pour rejoindre Runedelta après l’import, active **Chapitre → Fonctions facultatives → Activer le mode Runedelta**,
ouvre **⇅ Runedelta**, charge les branches, choisis celle de l’équipe et clique sur
**Ouvrir le catalogue Git**. L’éditeur utilise directement `strings/strings_chapitre_N.json` dans
le clone local. La copie dans `lang/lang_fr.json` est facultative et désactivée par défaut.

L’import génère localement :

- le catalogue anglais et les références vers le code GML ;
- les polices bitmap et les glyphes ;
- les portraits et les éléments nécessaires aux textbox ;
- les décors de rooms et les placements utiles au contexte visuel ;
- les associations entre dialogues, personnages et expressions.

Après l’import initial, le bouton **📂 Chapitre** permet de changer de chapitre ou de relancer la configuration.
Runedelta possède son propre écran et n’est pas requis pour commencer à traduire.

### Ajouter plusieurs langues à une copie vanilla

La préparation crée `lang/lang_fr.json`, `lang/lang_es.json`, etc., avec l’anglais comme texte initial.
Un fichier existant est conservé ; seules les clés absentes sont ajoutées. EN et JA restent disponibles.
Rouvrez **📂 Chapitre**, sélectionnez le même chapitre et une autre langue pour l’ajouter indépendamment.
Le lanceur adjacent est également adapté ; un chapitre sans fichier pour la langue choisie revient à l’anglais.

Les sprites et polices ont des variantes propres à chaque langue (`_fr`, `_es`, `_pt_br`…).
L’outil route leur affichage sans modifier les indices de sprites utilisés par la logique du jeu.
Le donneur apporte uniquement ses polices compatibles : ni ses textes ni ses images ne remplacent les originaux.
Les polices de corps différent sont signalées à la fin de la préparation. Vérifiez les glyphes dans l’aperçu et en jeu.
Ajouter un code de langue ne fournit pas automatiquement un alphabet,
une composition de texte ou une mise en page adaptés à toutes les écritures.

## Fonctionnalités

### Édition pensée pour la traduction

- recherche EN/FR insensible aux codes de contrôle ;
- filtres **Tout**, **À traduire**, **Dialogues**, **Menus** et **Sans réf** ;
- liste virtualisée, adaptée aux catalogues contenant plusieurs milliers de lignes ;
- navigation directe entre les prochaines traductions à effectuer ;
- copie du texte anglais ou de ses seuls tags de début et de fin ;
- coloration des codes de contrôle dans l’éditeur ;
- historique annuler/rétablir indépendant pour chaque ligne ;
- deux thèmes d’interface : DELTARUNE et classique.

### Preview fidèle au jeu

- modes automatiques et manuels : **Monde Sombre**, **Monde Clair**, **Shop**, **Bulle de combat**, **Texte de combat** et **Texte libre** ;
- polices bitmap, espacements et couleurs extraits depuis votre `data.win` ;
- détection automatique du portrait et de son expression depuis le GML ;
- substitution des arguments `~1`, `~2`, etc. ;
- reproduction du word-wrap et des limites de colonnes du writer ;
- décor contextuel 640×480 avec nom de room et choix manuel lorsque plusieurs scènes sont possibles ;
- comparaison rapide de la preview française avec le texte anglais.

### Sprites traduits

- onglet dédié avec recherche, filtres et liste virtualisée de tous les sprites du chapitre ;
- détection automatique des variantes portant le suffixe de la langue active ;
- comparaison pixelisée de l’original et de sa traduction, frame par frame ;
- export de la frame originale en PNG pour la retoucher dans l'éditeur d'images de son choix ;
- import d'un PNG par clic ou glisser-déposer, avec contrôle strict des dimensions ;
- dans un chapitre préparé avec le setup multilingue, import dans une variante indépendante, créée automatiquement si nécessaire ;
- annulation indépendante de chaque frame et réapplication automatique des imports lors des recompilations suivantes.

## Travailler avec Runedelta

DELTATRANSLATE sait utiliser directement le dépôt
[Traducteurs-Aurifiques/Runedelta](https://github.com/Traducteurs-Aurifiques/Runedelta) comme source de
traduction pour les chapitres 1 à 5. Les fichiers `strings/strings_chapitre_N.json` du dépôt possèdent le
même schéma que les catalogues du jeu. L’éditeur ouvre directement le fichier Git du chapitre,
sans convertir ni réordonner les clés. `Ctrl+S` modifie ce fichier local ; **Publier** envoie ses changements
sur la branche sélectionnée. Le jeu reste inchangé tant que la copie facultative est désactivée.

Pour le chapitre 5, la VO provient de `main/strings_og/chapter5.json`, quelle que soit la branche
de traduction sélectionnée. Elle complète les références manquantes et remplace leur texte anglais,
en conservant les métadonnées GML disponibles (portraits, scènes, modes de rendu). Une valeur identique
à cette VO reste « à traduire », sauf validation explicite « OK tel quel ». La récupération actualise
aussi la référence de `main`, sans changer la branche de travail. Les autres chapitres conservent leur
référence extraite lorsque le dépôt ne fournit pas de fichier `strings_og/chapterN.json`.

1. Importe le `data.win` du chapitre dans DELTATRANSLATE.
2. Active **Chapitre → Fonctions facultatives → Activer le mode Runedelta**, puis ouvre **⇅ Runedelta**.
3. Dans **Configurer l’accès GitHub et l’auteur des traductions**, clique sur **Se connecter à GitHub**. Le navigateur s’ouvre : saisis le code affiché dans l’application et autorise ton compte. Le dépôt est privé : accepte aussi l’invitation de l’équipe. Git et GitHub CLI sont intégrés ; la connexion ne modifie pas ta configuration Git globale.
4. Clique sur **Vérifier l’accès**, **Charger les branches du dépôt**, choisis une branche existante puis **Ouvrir le catalogue Git**. La vérification distingue l’accès Git en lecture des droits du compte GitHub CLI ; des identifiants Git/SSH personnalisés peuvent utiliser un autre compte. Les règles de branche peuvent encore refuser un push malgré le droit d’écriture.
5. Traduis normalement et sauvegarde avec `Ctrl+S`. Utilise **Récupérer** pour intégrer les traductions de l’équipe sans publier ton travail.
6. Pour contribuer, vérifie ton auteur Git, coche **Autoriser la publication sur GitHub**, puis clique sur **Publier**.

Le mode Runedelta, la publication GitHub et la copie dans le jeu sont désactivés par défaut. Sans le mode Runedelta, ses boutons sont masqués et aucune
vérification Git n’est lancée. Tu peux traduire et sauvegarder sans Git ni compte GitHub. Désactiver le mode
conserve les fichiers, le dépôt et sa configuration, et désactive aussi la publication. Réactiver le mode
ne réinstalle pas le catalogue ; la publication doit être autorisée à nouveau.

La connexion est propre à chaque installation, langue, chapitre, dépôt et branche. Chacun possède un
clone de travail distinct, afin de conserver les brouillons et commits non publiés lorsque tu changes
de chapitre ou de branche. Pour changer de branche, charge la liste, sélectionne la branche voulue puis
clique sur **Changer de branche**. Revenir à une branche retrouve son brouillon. Un changement de branche
fait hors de l’application bloque la sauvegarde jusqu’à reconnexion.

Les anciennes connexions doivent être reconnectées une fois avec **Ouvrir le catalogue Git**. L’ancien
fichier du jeu reste conservé ; il n’est pas importé automatiquement dans le catalogue de l’équipe.
Le chemin du fichier effectivement édité est affiché dans l’écran Runedelta.

**Copier aussi les traductions dans le jeu (lang/lang_fr.json)** est facultatif et désactivé par défaut.
Une fois activé, la connexion, la sauvegarde et la synchronisation mettent aussi à jour cette copie.
Son contenu précédent est sauvegardé avant remplacement, **même si les backups courants sont désactivés**.
Les sauvegardes et fusions du catalogue Git bénéficient aussi de cette protection. Les copies sont accessibles
dans l’historique ; les appels directs au module sans gestionnaire d’historique utilisent
`.git/deltatranslate-backups` dans le clone. Si la copie dans le jeu échoue, le catalogue Git reste sauvegardé
et l’application affiche l’erreur.

**Récupérer** télécharge les changements, résout les éventuels conflits et sauvegarde la fusion dans le
fichier local. Cette action ne crée aucun commit et ne publie rien, même lorsqu’une publication précédente
reste en attente. Sans réseau, elle signale l’échec et laisse le catalogue et sa référence intacts. Le statut
au repos reflète les dernières informations récupérées, sans garantir que GitHub n’a pas changé depuis.

Seul un clic sur **Publier**, après activation de la publication GitHub :

- récupère les nouveaux commits GitHub ;
- fusionne les changements clé par clé avec le travail local ;
- écrit le résultat dans `strings/strings_chapitre_N.json`, et dans le jeu uniquement si la copie est activée ;
- crée un commit descriptif des traductions ;
- pousse le commit sur la branche choisie si l’utilisateur Git configuré possède les droits d’écriture.

Pour chaque valeur différente de l’anglais, la liste et l’éditeur affichent tous les contributeurs Git ayant
modifié la ligne, dans l’ordre de leur première intervention et sans compter le commit initial d’import.
L’infobulle indique la date, le message et le commit de la dernière modification.

Deux personnes peuvent ainsi modifier des clés différentes sans conflit. Si la même clé a reçu deux
traductions différentes, aucune version n’est écrasée : DELTATRANSLATE affiche les deux valeurs et demande
de choisir `LOCAL` ou `GITHUB`. Sans réseau ou sans droit de push, la sauvegarde locale et le commit sont
conservés ; le bouton Runedelta reste en avertissement et une synchronisation ultérieure reprend le commit.

L’application ne stocke aucun token GitHub. La connexion guidée passe par
[gh auth login](https://cli.github.com/manual/gh_auth_login), et GitHub CLI gère les identifiants.
Les membres disposant de l’accès en lecture peuvent installer et récupérer sans autoriser la publication.
Un push refusé conserve le commit local ; il est possible de continuer à corriger les mêmes lignes puis
de réessayer avec un compte autorisé. Pour passer à un autre dépôt ou à un fork, déconnecte Runedelta puis
indique son URL : un espace de travail distinct est ouvert et l’ancien travail est conservé.

Après connexion guidée, l’auteur proposé est le compte GitHub et son adresse privée `users.noreply.github.com`.
Il peut aussi être renseigné dans **Nom de l’auteur / E-mail Git**. Cette identité s’applique uniquement au
clone Runedelta. L’identité Git existante reste utilisable ; une identité absente ou l’ancienne identité
générique bloque la publication avec une explication, sans bloquer la récupération.

La synchronisation concerne les catalogues de texte. Les sprites, polices, modifications de code et validations
locales de l’éditeur ne sont pas publiés par ces actions.

## Sauvegarde et sécurité

Le setup multilingue enregistre les textes dans le fichier propre à la langue. Les anciens projets restent lisibles :

| Situation détectée | Cible utilisée | Protection appliquée |
| --- | --- | --- |
| Langue préparée par le setup | `lang/lang_<code>.json` | Traductions existantes préservées, backup avant sauvegarde si activé |
| Runedelta est connecté | `strings/strings_chapitre_N.json` du clone Git ; copie dans le jeu facultative | Backup obligatoire ; Publier fusionne, commite puis pousse sur la branche choisie |
| Installation du sélecteur ou de sprites traduits | `data.win` du chapitre et, si présent, du lanceur | Sources immuables, compilation vérifiée, sauvegarde durable dans `deltatranslate-backups` |
| Ancien projet en mode recompilation | `data.win` actif | Source conservée et remplacement atomique ; réimporter pour passer au setup multilingue |

Garanties importantes :

- le `data.win` utilisé comme source d’extraction reste en lecture seule ;
- le fichier anglais de référence n’est jamais normalisé ni réordonné ;
- les backups sont **désactivés par défaut** et activables dans la barre du haut ; une fois activés, jusqu’à **40 sauvegardes avant écriture et 40 brouillons** sont conservés par cible, séparément pour chaque installation et langue ;
- un brouillon des modifications non enregistrées est conservé toutes les minutes lorsque les backups sont activés ;
- si le remplacement d’un `data.win` échoue, le fichier précédent est restauré ;
- si le jeu ou une traduction change pendant la compilation, l’installation est refusée avant remplacement ;
- les textures, sprites, polices et sons d’origine du chapitre sont comparés après recompilation ;
- les validations, choix de portrait, modes et autres préférences sont conservés séparément.

Le bouton **🗁 Historique** compare les copies avec le texte actuel et permet de restaurer une seule ligne dans l’éditeur. La restauration doit ensuite être enregistrée pour être appliquée au jeu. Les anciennes copies, dont le nom seul ne permet pas d’identifier le chapitre, restent accessibles via **Ouvrir le dossier des backups**.

Les écritures JSON passent par un fichier temporaire validé puis renommé. Si le fichier a été modifié par un autre programme depuis son chargement, la sauvegarde est refusée et, si les backups sont activés, une copie de la saisie est conservée dans l’historique. Les caractères saisis pendant une sauvegarde restent dans l’éditeur et sont signalés comme non enregistrés. La fermeture propose **Enregistrer**, **Quitter sans enregistrer** et **Annuler**.

Les validations et les choix de portrait, de boîte et de scène sont isolés par installation et langue. Les préférences historiques sont rattachées au projet actif à leur première migration, sans suppression du document d’origine. Le thème et le réglage des backups restent communs.

Le bouton **Contrôle qualité** est temporairement retiré de l’interface.

Les résultats sont filtrables et affichés par groupes de 100 ; cliquer sur une clé ouvre la traduction. L’analyse peut être interrompue. Les clés absentes de la référence anglaise restent accessibles via **Sans réf**.

### Réimport et mises à jour du jeu

Le réimport prépare une extraction séparée et l’active après réussite. L’annulation conserve l’extraction précédente ; la phase finale d’installation est protégée contre l’annulation. **Options avancées → Réextraire toutes les ressources** force la reconstruction.

Si le jeu diffère de la version importée et des compilations connues, l’application demande un original vérifié. L’option **Le fichier sélectionné est un nouvel original** permet d’importer une mise à jour officielle ; les anciennes sources sont conservées. Les traductions retrouvées sans ambiguïté par leur fichier et leur anglais sont proposées dans l’éditeur comme modifications à enregistrer. Un anglais modifié est signalé par le contrôle qualité. Les anciens overrides incompatibles restent archivés dans l’espace de traduction.

Les tests de sauvegarde, migration, isolation des préférences et restauration sont exécutés sur les pull requests et avant les releases sous Windows, macOS et Linux.

## Raccourcis et codes de contrôle

### Raccourcis

| Touche | Action |
| --- | --- |
| `Ctrl+S` / `Cmd+S` | Sauvegarder dans la cible active |
| `Ctrl+↓` / `Ctrl+↑` | Aller à la traduction suivante / précédente |
| `Ctrl+Entrée` ou `Ctrl+D` | Marquer ou démarquer la ligne comme **OK tel quel**, puis avancer |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / rétablir dans la ligne active |
| `Entrée` | Insérer un saut de ligne du jeu (`&`) |
| `Maj+Entrée` | Insérer une vraie nouvelle ligne dans la valeur |
| `Alt` | Ouvrir la roue d’insertion rapide des tags |

### Codes principaux

| Code | Effet |
| --- | --- |
| `&` | Saut de ligne dans la textbox |
| `^1`…`^9` | Pause pendant l’affichage |
| `~1`, `~2`, … | Argument substitué par le jeu |
| `/` | Attendre la confirmation du joueur |
| `%` | Passer au message suivant |
| `/%` | Terminer la séquence |
| `\E?` | Expression du portrait |
| `\F?` | Personnage du portrait |
| `\c?` | Couleur du texte |
| `\T?` | Voix ou style de texte |
| `\|` | Espace fine |
| `` \` `` | Échapper le caractère suivant |

## Données locales et confidentialité

Le dépôt et les livrables contiennent uniquement le code de DELTATRANSLATE. Aucun `data.win`, texte, sprite, portrait, décor, son ou fichier extrait de DELTARUNE n’est inclus.

Les fichiers générés lors d’un import restent sur votre machine :

- extraction UTMT et références locales ;
- traductions intermédiaires ;
- préférences par clé ;
- sauvegardes horodatées ;
- installation UTMT gérée par l’application, le cas échéant.
- clone Git local de Runedelta, si la synchronisation a été activée.

Ces données sont placées dans le dossier utilisateur de l’application. Les anciennes installations qui possèdent déjà `config.json`, `prefs.json`, `backups/` ou `extracted-imports/` à côté du code continuent d’utiliser ces emplacements afin de ne pas perdre le travail existant.

Chaque nouvelle extraction utilise un dossier propre à l’installation du jeu et au chapitre. Deux copies
de DELTARUNE peuvent ainsi être traduites séparément. Les anciens dossiers d’extraction sont réutilisés
quand leur manifeste identifie la même installation.

## Développement

### Architecture

```text
main.js                       Processus principal Electron, IPC et sauvegardes
updater.js                    Détection, téléchargement et installation des releases GitHub
runedelta-sync.js             Clone, fusion à trois versions, commit et push Runedelta
preload.js                    API sécurisée exposée au renderer
src/app.js                    Interface, navigation et état de l’éditeur
src/sprites.js                Catalogue, comparaison et import des sprites traduits
src/engine/writer.js          Word-wrap et interprétation des codes de contrôle
src/engine/preview.js         Rendu canvas des différents modes de texte
src/engine/bitmapfont.js      Chargement et teinte des polices bitmap
extraction/import-datawin.mjs Pipeline d’import complet via UTMT
extraction/import-lib.mjs     Analyse du GML et construction du catalogue
extraction/export-sprite.mjs  Extraction à la demande des aperçus de sprites
extraction/patch-datawin.mjs  Recompilation sécurisée des traductions
```

Le processus principal et le preload sont en CommonJS. Le renderer et les scripts d’extraction utilisent les modules ESM.

### Releases et mises à jour

Chaque tag (`v1.2.1` pour la version `1.2.1`) construit les éditions Standard et Avec-Git sur Windows, macOS et Linux dans une seule release. Le workflow peut aussi reconstruire une release existante. Les canaux `latest*.yml` et `bundled*.yml` conservent l’édition choisie lors des mises à jour.

Les releases doivent être lisibles publiquement pour que les installations puissent les consulter sans secret. Ne jamais embarquer de token GitHub dans l’application. Sur macOS, les mises à jour automatiques nécessitent également une application signée.

### Commandes utiles

```bash
# Lancer l’application
npm start

# Import avancé ou régénération complète d’un chapitre
node extraction/import-datawin.mjs \
  --datawin "/chemin/vers/data.win" \
  --cli "/chemin/vers/UndertaleModCli" \
  --force
```

Toute modification du rendu doit pouvoir être reliée au comportement observé dans le GML décompilé. Les données extraites servent uniquement de cache local de développement et ne doivent jamais être ajoutées au dépôt.

## Dépannage

<details>
<summary><strong>L’application demande UTMT à chaque lancement</strong></summary>

Dans **Chapitre → Options avancées**, vérifiez que le dossier lié contient bien `UndertaleModCli.exe`
sous Windows ou `UndertaleModCli` sous macOS/Linux. L’installation automatique est relancée si aucun outil utilisable n’est trouvé.
</details>

<details>
<summary><strong>L’import semble bloqué</strong></summary>

La première extraction décompile le code et exporte plusieurs ressources ; elle peut rester plusieurs minutes sur une même étape.
Le temps écoulé continue de s’afficher. Ouvrez **Détails de la préparation** pour consulter le journal.
Si un téléchargement échoue, vérifiez la connexion puis cliquez sur **Réessayer la préparation** ;
une installation locale d’UTMT peut aussi être liée depuis **Options avancées**.
</details>

<details>
<summary><strong>Une ligne reste dans « À traduire » alors que le français est identique</strong></summary>

C’est volontaire : une ligne est considérée comme non traduite lorsque son texte français est identique à l’anglais. Utilisez `Ctrl+Entrée` ou `Ctrl+D` pour la marquer **OK tel quel**.
</details>

<details>
<summary><strong>Le jeu a été mis à jour</strong></summary>

Relancez un import complet avec l’option `--force` afin de régénérer le code, les ressources, le catalogue et les décors depuis le nouveau `data.win`.
</details>

## Projet non officiel

DELTATRANSLATE est un projet communautaire non officiel, sans affiliation avec les créateurs ou éditeurs de DELTARUNE. Les noms et marques cités appartiennent à leurs détenteurs respectifs.
