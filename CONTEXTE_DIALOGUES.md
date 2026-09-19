# Détection du contexte des dialogues à partir du code du jeu

## Vue d’ensemble

L’outil reconstruit le contexte d’un texte en analysant le GML décompilé du `data.win`. Cette analyse a lieu pendant l’import du chapitre, pas au moment où la preview est affichée.

Le pipeline est le suivant :

```text
data.win
  │
  ├─ UTMT extrait les CodeEntries en fichiers .gml
  ├─ import-lib.mjs repère les textes localisés dans ces fichiers
  ├─ import-lib.mjs déduit leur canal, leur mode, leur visage et leur typer
  ├─ room-context.mjs construit la liste des objets et rooms à rechercher
  ├─ export-room-context.csx lit les placements réels dans le data.win
  └─ toutes les métadonnées sont réunies dans reference.json

reference.json
  │
  └─ src/app.js choisit le contexte final et appelle preview.js
```

Il faut distinguer trois catégories d’informations :

1. **Informations lues directement** : texte anglais, clé de localisation, fichier GML, ligne, objets placés dans une room, coordonnées des instances.
2. **Informations déduites statiquement** : type de textbox, visage actif, room obtenue par un objet créateur, position probable de caméra.
3. **Décisions de l’interface** : choix final entre monde clair et monde sombre, application d’un override manuel et sélection d’une room lorsqu’il y en a plusieurs.

L’outil n’exécute pas le GML. Il ne connaît donc pas la valeur réelle des variables, la branche d’un `if` prise pendant une partie ou l’état d’une sauvegarde. Il recherche des motifs dans le code et applique des priorités définies.

## 1. Extraction du GML depuis le `data.win`

`extraction/import-datawin.mjs` lance UndertaleModTool en ligne de commande. UTMT lit les ressources GameMaker du `data.win` et produit notamment :

- `CodeEntries/*.gml` : code du jeu décompilé ;
- `fonts/` et `sprites/` : ressources nécessaires à la preview ;
- les informations de rooms utilisées ensuite par le script C# d’extraction des décors.

Un fichier décompilé ressemble par exemple à :

```text
gml_Object_obj_dw_npc_flower_Step_0.gml
```

Son nom indique que le code appartient à l’événement `Step 0` de `obj_dw_npc_flower`. L’analyse peut donc retrouver l’objet propriétaire sans interpréter le contenu du fichier : elle retire le préfixe `gml_Object_` et le suffixe de l’événement.

## 2. Repérage de tous les textes localisés

La première passe importante est `scanCatalog()` dans `extraction/import-lib.mjs`.

Elle parcourt tous les `.gml` et cherche ces fonctions :

```js
stringsetloc
stringsetsubloc
msgsetloc
msgsetsubloc
msgnextloc
msgnextsubloc
c_msgsetloc
c_msgsetsubloc
c_msgnextloc
c_msgnextsubloc
```

La regex `CALL_RE` repère le début de l’appel. Les arguments sont ensuite lus par `parseArgs()`, qui sait traverser les parenthèses, tableaux, virgules et chaînes échappées. Cela évite de casser un appel contenant lui-même une fonction imbriquée.

Avec un appel de ce type :

```gml
c_msgsetloc(message_index, "Hello!%", "obj_example_Step_0_gml_12_0");
```

l’analyse enregistre :

```json
{
  "en": "Hello!%",
  "call": "c_msgsetloc",
  "channel": "cutscene-message",
  "file": "gml_Object_obj_example_Step_0",
  "line": 12
}
```

La ligne est calculée en comptant les retours à la ligne avant l’index de l’appel.

### Les canaux

Le nom de la fonction détermine le premier niveau de contexte :

| Appel GML | Canal enregistré | Signification |
| --- | --- | --- |
| `stringsetloc` | `string` | Chaîne générique, pas forcément un dialogue |
| `msgsetloc` | `message` | Premier message d’une file de dialogue |
| `msgnextloc` | `message-next` | Message suivant |
| `c_msgsetloc` | `cutscene-message` | Message ajouté par le système de cinématique |
| `c_msgnextloc` | `cutscene-next` | Suite d’une cinématique |

Les variantes `subloc` utilisent les mêmes canaux. Elles ont en plus des paramètres `~1`, `~2`, etc. L’import essaie d’en résoudre les valeurs statiques ou de trouver un exemple dans une assignation proche.

Ce canal est important, car une `string` peut être un nom de menu, une option ou un dialogue stocké temporairement. À l’inverse, un canal `message` ou `cutscene-*` est déjà une preuve forte que le texte passe par le writer de dialogue.

### Cas des chapitres 1 et 2

Dans les anciens chapitres, l’anglais n’est souvent pas fourni directement dans les appels GML. Le code demande une clé avec `scr_84_get_lang_string()` et le texte se trouve dans `lang_en.json`.

Si le scan trouve moins de 50 appels inline, l’import bascule sur `buildReferenceFromLangJson()`. Il utilise alors `lang_en.json.original` pour les textes anglais, puis recherche les usages des clés dans le GML afin de récupérer un fichier, une ligne et les mêmes informations de contexte.

## 3. Détection statique du type de textbox

La première détection est faite par `inferPreviewMode()` pendant la construction de `reference.json`. Elle reçoit :

- le nom du fichier GML ;
- le texte anglais ;
- la ligne GML complète contenant l’appel ;
- le canal ;
- la liste des objets qui utilisent `scr_battletext()` quelque part dans leurs événements.

### 3.1 Dialogue de boutique

`isLargeShopDialogue()` exige trois indices :

1. le fichier appartient à un objet `obj_shop...` ;
2. le texte commence visiblement par `*`, après retrait des premiers tags ;
3. le texte se termine par `/`, `%` ou `/%`, qui sont des codes de flux du writer.

Le mode enregistré est alors `shop`.

Cette vérification distingue le grand dialogue du vendeur des petits libellés du menu de boutique qui peuvent provenir du même objet.

### 3.2 Texte de combat en bas de l’écran

Avant de traiter les entrées, `findBattleTextOwners()` cherche `scr_battletext()` ou `scr_battletext_default()` dans tous les fichiers. Le résultat est un ensemble d’objets propriétaires, événements confondus.

C’est nécessaire dans un cas comme celui-ci :

```gml
// Create : le texte est déclaré
attack_text = stringsetloc("* Something attacks!%", "id_attack");

// Step : le même objet l’envoie au panneau de combat
scr_battletext(attack_text);
```

L’appel de localisation et l’appel de rendu ne sont pas forcément dans le même événement, mais ils appartiennent au même objet.

Si le propriétaire est un battle owner et que le texte commence par `*`, le mode devient `battletext`. Une assignation directe à `global.battlemsg[...]` produit aussi ce mode.

### 3.3 Bulle ennemie ou panneau de combat

Pour les fichiers dont le nom contient par exemple `enemy`, `battle`, `attack`, `encounter`, `boss` ou `blcon`, l’import ne force pas toujours immédiatement un mode. Le même objet peut alterner entre dialogues de cinématique, bulles et panneau inférieur.

Dans `src/app.js`, `autoMode()` tranche les cas de combat restants :

```text
texte visible commençant par *  → battletext
autre texte de contexte combat  → bubble
```

Les premiers tags comme `\T`, `\E`, `^1`, `|` ou `&` sont ignorés pour trouver le premier caractère réellement affiché.

### 3.4 Chaîne générique requalifiée en dialogue

Pour une entrée de canal `string`, `inferPreviewMode()` inspecte sa ligne GML.

Elle la requalifie en `darkbox` si elle voit notamment :

```gml
global.msg[0] = stringsetloc(...)
msgset(...)
global.choicemsg[0] = stringsetloc(...)
scr_readychoicer(...)
```

Elle accepte également un texte qui se termine par un code de fermeture du writer : `/`, `%`, `/%` ou `%%`.

`endsWithWriterClose()` évite deux faux positifs :

- un `/` précédé d’une espace est considéré comme un caractère affiché, par exemple `Numpad /` ;
- un `%` précédé d’un chiffre est considéré comme un pourcentage, par exemple `100%`.

Si aucune preuve de dialogue n’est trouvée, la chaîne reste en mode `plain`.

### 3.5 Messages de cinématique

Les canaux `cutscene-message` et `cutscene-next` sont traités dans `autoMode()` avant l’heuristique basée sur le nom du fichier. Ils deviennent une textbox classique.

Cet ordre est volontaire. Un objet nommé `encounter` peut contenir une cinématique avant le combat ; son nom seul ne doit pas transformer le dialogue de la cinématique en bulle ennemie.

### 3.6 Appareils spéciaux

`findTyper()` cherche les assignations `global.typer = N` ou les speakers qui imposent un typer particulier.

Quand le typer vaut `666` ou `667`, `findDeviceStyle()` cherche ensuite la création de `obj_writer` dans les 40 lignes suivantes :

```gml
instance_create(x, y, obj_writer);
```

Les coordonnées statiques et une éventuelle multiplication de `hspace` sont conservées. Le nom de l’objet permet aussi de choisir le fond `contact` ou `failure`. L’entrée reçoit alors `previewMode: "device"` et un objet `deviceStyle`.

## 4. Ordre final de sélection du mode

Pendant l’affichage, `autoMode()` applique les règles dans cet ordre :

1. un texte secondaire lié par `scr_smallface` utilise une textbox sombre ;
2. un grand dialogue de boutique utilise `shop` ;
3. un canal `cutscene-*` utilise une textbox classique ;
4. le `previewMode` calculé à l’import est utilisé ;
5. un fichier de combat devient `battletext` ou `bubble` selon l’astérisque ;
6. une `string` terminée comme un message devient une textbox, sinon `plain` ;
7. les autres canaux deviennent une textbox classique.

Avant `autoMode()`, `effectiveMode()` vérifie les choix manuels :

```text
sélecteur actuellement forcé
  puis prefs.modeOverrides[id]
  puis autoMode()
```

Un override utilisateur est donc toujours prioritaire sur l’analyse du jeu.

## 5. Distinction entre textbox du monde sombre et du monde clair

Le jeu utilise réellement `global.darkzone`, modifié entre autres par `scr_become_dark` et `scr_become_light`. L’analyse statique ne peut pas connaître sa valeur exacte à l’instant du message.

L’outil commence donc avec `darkbox`, puis `lightWorldAdjust()` consulte la room sélectionnée. Si son nom correspond à une liste de préfixes connus du monde clair, le mode devient `lightbox` :

```text
room_town...
room_lw_...
room_hospital...
room_school...
room_kris...
room_tor...
room_diner...
room_library...
room_flowershop...
room_graveyard...
room_townhall...
room_beach...
room_insidecloset...
room_alphys...
room_church...
room_icehouse...
room_man
```

La liste est volontairement restrictive. Une room inconnue ne doit pas être classée en monde clair sur une simple supposition.

## 6. Construction du lien entre un texte, un objet et une room

Cette partie se trouve dans `extraction/room-context.mjs`.

### 6.1 Retrouver l’objet propriétaire

Pour chaque entrée de `reference.json`, `objectFromCodeFile()` applique une regex au nom du fichier :

```text
gml_Object_(nom de l’objet)_(événement)_(numéro)
```

Exemple :

```text
gml_Object_obj_dw_npc_flower_Step_0
                     ↓
             obj_dw_npc_flower
```

Les entrées `string` ordinaires sont ignorées pour le contexte de room afin de ne pas associer tous les menus à un objet global présent partout. Une `string` n’est retenue que si elle a déjà été requalifiée en `shop` ou `darkbox`, ou si elle participe à un `smallFace`.

### 6.2 Construire le graphe de création des objets

`scanCreationGraph()` parcourt tous les fichiers d’objets et cherche :

```gml
instance_create(..., obj_target)
instance_create_layer(..., obj_target)
instance_create_depth(..., obj_target)
```

Pour chaque création, il enregistre une relation inversée :

```text
objet créé → objets capables de le créer
```

Par exemple :

```gml
// Code de obj_cutscene_controller
instance_create_layer(x, y, "Instances", obj_dialogue_helper);
```

devient :

```text
obj_dialogue_helper → obj_cutscene_controller
```

À partir de l’objet qui contient le texte, `collectRoomContextRequests()` remonte ce graphe jusqu’à quatre niveaux. Cela permet de demander à UTMT les placements directs de l’objet, mais aussi les placements de ses créateurs potentiels.

Le même scan relève toutes les occurrences de noms `room_...` dans chaque objet. Ces références explicites servent de dernier recours.

### 6.3 Chercher une caméra statique

Pour chaque texte éligible, `findStaticCamera()` remonte au maximum 500 lignes avant l’appel et cherche :

```gml
c_pan(x, y)
c_pan_wait(x, y)
c_panspeed(x, y)
c_panspeed_wait(x, y)
c_pan_fancy(x, y)
```

Seules des coordonnées numériques littérales sont acceptées. Une commande `c_pan(target_x, player.y)` ne peut pas fournir de vue exacte pendant une analyse statique.

La première commande trouvée en remontant est utilisée. L’analyse ne vérifie pas si elle se trouve dans la même branche conditionnelle que le dialogue.

## 7. Lecture des placements réels dans le `data.win`

`extraction/export-room-context.csx` est exécuté par UTMT avec accès aux structures GameMaker originales.

Pour chaque objet demandé, le script parcourt :

```csharp
Data.Rooms
room.GameObjects
```

Il compare l’objet de chaque instance à l’objet demandé. `MatchesObject()` remonte également `ParentId`, ce qui permet de reconnaître une instance d’un enfant comme placement d’un objet parent.

Le résultat distingue :

- `direct` : l’instance est exactement l’objet demandé ;
- `child` : l’instance hérite de l’objet demandé.

Pour chaque placement, le script conserve :

```json
{
  "room": "room_town_01",
  "instanceId": 12345,
  "sourceObject": "obj_npc_flower_child",
  "cameraX": 0,
  "cameraY": 240,
  "focusX": 310,
  "focusY": 460,
  "roomWidth": 1280,
  "roomHeight": 960,
  "via": "child"
}
```

Les coordonnées `focusX` et `focusY` sont celles de l’instance. La vue 640 × 480 est centrée sur ce point, puis limitée aux bords de la room.

Pour une commande de caméra statique, le script cherche toutes les rooms contenant l’objet concerné et extrait directement la vue aux coordonnées de la commande.

## 8. Génération du décor de room

Le même script C# reconstruit une image statique de la room.

`RenderRoom()` dessine, dans l’ordre de profondeur de GameMaker :

- la couleur de fond ;
- les layers de background, avec leur répétition et leur étirement ;
- les tile layers, y compris rotations et retournements encodés ;
- les assets et sprites placés dans la room ;
- l’image initiale des instances placées.

Le rendu est réalisé en nearest-neighbor afin de conserver les pixels du jeu.

Cette image n’est pas une capture d’une partie en cours. Elle ne peut pas montrer correctement :

- une animation à son frame réel ;
- un objet déplacé pendant la scène ;
- un objet créé uniquement à l’exécution ;
- un changement de sprite dépendant d’une variable ;
- un layer rendu visible ou invisible par le code pendant la scène.

Elle fournit le décor statique le plus proche que l’on puisse reconstruire depuis les ressources de la room.

## 9. Attribution d’un contexte de room à chaque texte

Après l’extraction UTMT, `attachRoomContexts()` reprend chaque texte et teste les sources dans un ordre strict.

### Priorité 1 : caméra exacte

Si une commande `c_pan...` statique a été trouvée et qu’UTMT a trouvé une room compatible, le contexte reçoit :

```json
{
  "confidence": "camera-exact",
  "reason": "caméra c_pan(320, 240)"
}
```

### Priorité 2 : placement de l’objet

Si l’objet propriétaire est placé dans une room :

- placement direct → `confidence: "exact"` ;
- placement par héritage GameMaker → `confidence: "high"`.

### Priorité 3 : placement d’un objet créateur

Si l’objet n’est placé nulle part, le code remonte le graphe des créateurs jusqu’à quatre niveaux. Une room trouvée ainsi reçoit `confidence: "inferred"`.

Exemple :

```text
texte dans obj_dialogue_helper
obj_dialogue_helper créé par obj_cutscene_controller
obj_cutscene_controller placé dans room_castle
→ room_castle, contexte déduit
```

### Priorité 4 : nom de room référencé dans le GML

Si aucune instance ni aucun créateur n’aboutit, les noms `room_...` présents dans le code de l’objet sont utilisés comme dernier recours, toujours avec `confidence: "inferred"`.

Les doublons sont supprimés selon l’image et le point d’ancrage. Plusieurs contextes peuvent rester si le même objet apparaît dans plusieurs rooms ou plusieurs positions.

Ces contextes sont ajoutés à l’entrée sous `sceneContexts` dans `reference.json`.

## 10. Détection du visage et du typer

Le visage ne vient pas du texte seul. Dans DELTARUNE, un appel comme `c_facenext()` change l’état du writer pour les messages suivants.

### 10.1 Recherche du visage actif

`findFace()` part de la ligne du texte et remonte jusqu’à 120 lignes. Le premier changement de visage reconnu gagne.

Il reconnaît notamment :

```gml
global.fc = 2;
global.fe = 1;

c_facenext("susie", "C");
c_face("ralsei", 2);
c_msgface("noelle", 3);

scr_anyface_next("queen", 4);
scr_anyface("susie", msgno, 2);

scr_susface(msgno, 5);
scr_ralface(msgno, 1);

c_speaker("susie");
scr_speaker("ralsei");
```

Une table `SPEAKER_FC` convertit les noms de personnages vers le numéro `fc` attendu par `obj_face`. Une autre table relie les fonctions dédiées, comme `scr_susface`, au même numéro.

Les tags inline présents dans les lignes précédentes sont aussi reconnus :

```text
\FS → Susie
\FR → Ralsei
\FN → Noelle
\E0…\Ez → expression encodée
```

Dans les fichiers GML décompilés, les backslashes sont doublés. La regex cherche donc littéralement `\\F(.)` ou `\\E(.)` dans le fichier.

Le décodage d’expression suit celui du jeu : chiffres `0-9`, majuscules `A-Z`, puis minuscules `a-z`.

Cette recherche est lexicale. Si deux branches d’un `if` assignent des visages différents, le plus proche textuellement peut être retenu même si cette branche n’est pas celle exécutée dans le jeu.

### 10.2 Persistance entre textes proches

`src/app.js` construit aussi des séquences. Les textes d’un même fichier, séparés de six lignes ou moins, sont regroupés.

Pour afficher une entrée, `inheritedState()` part du visage détecté dans `reference.json`, puis relit les tags `\F` et `\E` des textes précédents de la séquence. Cela reproduit les cas où un portrait reste actif sur plusieurs messages.

Ce regroupement ne suit pas les embranchements de la cinématique. Il s’agit d’un complément local à la détection GML.

### 10.3 Typer

`findTyper()` remonte également 120 lignes et cherche :

- `global.typer = nombre` ;
- un appel de speaker connu pour imposer un typer particulier.

Si aucune valeur locale n’est trouvée, `findOwnerTypers()` peut utiliser la dernière assignation de typer trouvée dans l’événement `Create` du même objet.

Le typer détermine notamment la font, la couleur et l’espacement des caractères dans la preview.

## 11. Utilisation du contexte dans la preview

Quand une clé est sélectionnée, `runPreview()` prépare un objet `state` contenant notamment :

```js
{
  fc,
  fe,
  faceVariant,
  typer,
  sceneContext,
  bubbleSide,
  deviceStyle,
  smallFace,
  speakerOverlay
}
```

`selectedSceneContext()` prend :

1. le contexte enregistré dans `prefs.sceneOverrides[id]` s’il existe encore dans la liste ;
2. sinon le premier élément de `sceneContexts`.

Le décor de room n’est transmis que pour les modes `darkbox` et `lightbox`. Les bulles, panneaux de combat, appareils et textes libres ont leur propre rendu.

`Preview.render()` distribue ensuite vers :

```text
darkbox    → renderDialogue(..., dark: true)
lightbox   → renderDialogue(..., dark: false)
shop       → renderShop()
bubble     → renderBubble()
battletext → renderBattleText()
device     → renderDevice()
plain      → renderPlain()
```

Pour une lightbox, l’image extraite en 640 × 480 est recadrée sur 320 × 240 autour de `focusX` et `focusY`, car le monde clair utilise une vue plus petite. Le canvas remet ensuite cette vue à l’échelle d’affichage.

## 12. Exemple complet

Prenons ce GML fictif :

```gml
c_pan(640, 480);
c_facenext("susie", "2");
c_msgsetloc(message_index, "* Hey, Kris!%", "obj_castle_scene_Step_0_gml_150_0");
```

Le pipeline effectue les déductions suivantes :

1. `scanCatalog()` trouve `c_msgsetloc` et enregistre le canal `cutscene-message`.
2. Le fichier donne comme propriétaire `obj_castle_scene`.
3. `autoMode()` traite le canal de cinématique comme une textbox classique, même si le nom de l’objet contient éventuellement un terme lié au combat.
4. `findFace()` remonte et trouve `c_facenext("susie", "2")`, donc `fc = 1` et `fe = 2`.
5. `findStaticCamera()` remonte et trouve `c_pan(640, 480)`.
6. UTMT cherche les rooms contenant `obj_castle_scene` et extrait la vue à ces coordonnées.
7. `attachRoomContexts()` marque cette vue `camera-exact`.
8. Si la room ne correspond pas à un préfixe connu du monde clair, la textbox reste une darkbox.
9. `runPreview()` transmet le décor, le visage et le mode à `Preview.render()`.

Le `*` n’en fait pas un `battletext`, car le canal `cutscene-*` est traité avant les heuristiques de combat.

## 13. Limites précises de l’analyse

Le système connaît bien la structure statique du jeu, mais il ne construit ni AST complet ni graphe de flot de contrôle. Concrètement :

- les recherches de visage et de typer remontent 120 lignes ;
- la recherche de caméra remonte 500 lignes ;
- le graphe de créations est suivi sur quatre niveaux ;
- le premier motif pertinent trouvé en remontant gagne ;
- les conditions, boucles et valeurs runtime ne sont pas évaluées ;
- une fonction intermédiaire non reconnue peut masquer une relation ;
- un nom d’objet ou de variable inhabituel peut échapper aux heuristiques ;
- un objet partagé peut produire plusieurs rooms valides.

L’application expose donc le niveau de confiance du contexte et permet de forcer manuellement :

- le mode avec `modeOverrides` ;
- la room avec `sceneOverrides` ;
- le visage avec `faceOverrides` ;
- le côté d’une bulle avec `bubbleSides`.

Ces corrections sont enregistrées dans `prefs.json` et ne modifient ni le `data.win` ni les fichiers extraits.

## Fichiers principaux

| Fichier | Responsabilité |
| --- | --- |
| `extraction/import-datawin.mjs` | Orchestration de l’import |
| `extraction/import-lib.mjs` | Scan des textes, canal, mode, visage, typer et styles spéciaux |
| `extraction/room-context.mjs` | Graphe de création, recherche de caméra et attribution des rooms |
| `extraction/export-room-context.csx` | Lecture des rooms dans UTMT et rendu des décors |
| `src/app.js` | Mode final, séquences, overrides et préparation du state |
| `src/engine/preview.js` | Rendu canvas du décor et de la textbox |

Les données générées, comme `room-context.json`, `room-scenes/` et `reference.json`, restent dans le cache local du chapitre. Elles sont reconstruites à partir du `data.win` fourni par l’utilisateur et ne doivent pas être distribuées avec l’application.
