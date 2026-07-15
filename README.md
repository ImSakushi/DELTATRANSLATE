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
- les décors des rooms, leurs couches de tiles/sprites et les placements des
  objets qui déclenchent les dialogues ;
- la référence anglaise et les visages associés aux lignes.

Les extractions sont placées dans les données locales de l'application et ne sont
jamais versionnées par Git.

Le contexte visuel est lui aussi entièrement généré depuis le `data.win` : pour
chaque texte, l'import relie son objet GML aux rooms qui le contiennent et produit
une vue 640×480. Lorsqu'une cutscene contient un `c_pan(x, y, …)` statique, la vue
reprend directement ces coordonnées de caméra. Les contextes ambigus restent
sélectionnables dans la preview. Après une mise à jour du jeu, un import avec
`--force` régénère le code, les ressources et les décors.

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
- décor contextuel automatique derrière les textbox, avec nom de room, niveau
  de confiance et choix manuel quand plusieurs placements sont possibles ;
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
