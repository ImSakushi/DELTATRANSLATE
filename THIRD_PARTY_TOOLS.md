# Outils intégrés

Cette édition inclut Git via [dugite-native](https://github.com/desktop/dugite-native/releases/tag/v2.53.0-4) et [GitHub CLI 2.101.0](https://github.com/cli/cli/releases/tag/v2.101.0).

Git est distribué sous GNU GPL version 2. Les notices et licences des composants sont conservées dans les distributions intégrées. La release DELTATRANSLATE fournit également les archives sources de [Git pour macOS/Linux](https://github.com/git/git/tree/67ad42147a7acc2af6074753ebd03d904476118f), de [Git for Windows](https://github.com/git-for-windows/git/tree/v2.53.0.windows.4) et des [scripts de construction dugite-native](https://github.com/desktop/dugite-native/tree/v2.53.0-4). Les versions et sources des autres composants sont référencées dans le fichier dependencies.json de dugite-native.

GitHub CLI est distribué sous licence MIT. Sa licence est conservée dans le dossier tools de l'application. Son code source est disponible au tag v2.101.0 du dépôt lié ci-dessus.

Les bindings [dugite 3.2.3](https://github.com/desktop/dugite) sont distribués sous licence MIT.

Les archives sont téléchargées à la construction, avec vérification SHA-256. Aucun outil n'est installé dans le système ni ajouté au PATH global. La connexion GitHub utilise le flux officiel par navigateur de GitHub CLI. Les identifiants sont gérés par GitHub CLI ; la configuration Git globale n'est pas modifiée par la connexion depuis DELTATRANSLATE.
