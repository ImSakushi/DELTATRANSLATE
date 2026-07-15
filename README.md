# DELTATRANSLATE

Éditeur de traduction pour les chapitres de **DELTARUNE**, avec aperçu fidèle au
moteur du jeu : polices bitmap, portraits, boîtes de dialogue et bulles de combat.

Le dépôt ne contient aucun dump GML, sprite, police ou texte extrait du jeu. Tout
est généré localement depuis le `data.win` choisi par l'utilisateur.

## Installation

```bash
npm install
npm start
```

Au premier lancement, l'assistant propose deux possibilités :

- lier un dossier contenant une installation existante d'UTMT CLI ;
- cliquer sur **Installer UTMT** pour télécharger automatiquement la dernière
  release CLI officielle correspondant à Windows, macOS ou Linux.

La release est recherchée dynamiquement avec l'API GitHub officielle du projet
[UndertaleModTool](https://github.com/UnderminersTeam/UndertaleModTool/releases/).

## Importer un chapitre

Après la configuration d'UTMT, glisser-déposer le `data.win` dans l'assistant ou
cliquer sur **Choisir un data.win…**. DELTATRANSLATE extrait alors localement :

- le code GML nécessaire au catalogue anglais et au contexte des dialogues ;
- les polices bitmap ;
- les portraits et éléments de textbox utiles à la preview ;
- la référence anglaise et les visages associés aux lignes.

Les extractions sont placées dans les données locales de l'application et ne sont
jamais versionnées par Git.

### Choix de la cible de sauvegarde

- Si `lang/lang_fr.json` existe, il est toujours prioritaire, y compris pour les
  chapitres 1 et 2. Une copie horodatée est créée avant chaque écriture.
- Pour les chapitres récents sans `lang_fr.json`, `data.win` devient la cible :
  `data-original.win` conserve une copie anglaise immuable, puis
  chaque sauvegarde recompile les traductions dans le `data.win` actif via UTMT.
- Pour les anciens chapitres dont le moteur lit les textes depuis `lang_en.json`,
  l'outil édite ce fichier directement et préserve `lang_en.json.original`. Écrire
  ces textes dans `data.win` n'aurait aucun effet dans ces versions du moteur.

## Sécurité des sauvegardes

- Le fichier source anglais n'est jamais modifié.
- Les fichiers JSON sont sauvegardés avant écriture, avec 40 versions conservées
  par cible.
- En mode `data.win`, UTMT écrit d'abord un nouveau fichier temporaire. Le fichier
  actif n'est remplacé qu'après validation de la sortie, avec restauration du
  précédent fichier si le remplacement échoue.

## Fonctionnalités

- recherche EN/FR insensible aux codes de contrôle ;
- filtre « À traduire » et validation « OK tel quel » ;
- regroupement des lignes voisines d'une même séquence ;
- preview temps réel en modes monde sombre, monde clair, combat et texte libre ;
- détection automatique des portraits depuis le GML ;
- compteurs de colonnes reproduisant le word-wrap du jeu ;
- import autonome de tous les chapitres pris en charge par UTMT.

## Raccourcis

| Touche | Action |
| --- | --- |
| `Ctrl+S` | Sauvegarder dans la cible active |
| `Ctrl+↓` / `Ctrl+↑` | Traduction suivante / précédente |
| `Ctrl+D` | Marquer ou démarquer « OK tel quel » |

## Codes de contrôle principaux

| Code | Effet |
| --- | --- |
| `&` | saut de ligne |
| `^1`…`^9` | pause |
| `/` | attendre la confirmation |
| `%` | message suivant |
| `/%` | fin de séquence |
| `\En` | expression du portrait |
| `\Fx` | personnage du portrait |
| `\cX` | couleur |
| `\Tx` | voix ou style |

## Développement

Le processus principal Electron est en CommonJS, le renderer et les scripts
d'extraction sont en ESM. L'import UTMT est piloté par
`extraction/import-datawin.mjs`; la recompilation directe de `data.win` passe par
`extraction/patch-datawin.mjs`.
