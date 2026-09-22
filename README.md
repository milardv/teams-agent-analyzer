# Reply Board

Dashboard local qui lit trois conversations Microsoft Teams, repère les questions Coach/Academy, fait chercher Codex dans le dépôt correspondant en lecture seule et prépare une réponse copiable.

## Démarrage

```bash
npm test
npm start
```

Ouvrir ensuite <http://127.0.0.1:4317>, puis cliquer sur **Ouvrir Teams**.

## Connexion Microsoft Teams sans droits administrateur

L'application ouvre un profil Chrome dédié dans `data/teams-browser-profile`. Connectez-vous une fois à Teams dans cette fenêtre et laissez-la ouverte ou réduite. Le tableau lit uniquement les messages rendus dans ces trois conversations, via l'interface locale de Chrome ; il ne copie ni cookie ni jeton et ne publie jamais de réponse.

Ce mode ne nécessite ni application Entra ni consentement administrateur. Chrome doit être installé sous la commande `google-chrome`.

## Connexion Microsoft Graph facultative

Une application Entra de type client public peut également être utilisée avec les permissions **déléguées** suivantes :

- `Chat.Read`
- `ChannelMessage.Read.All`
- `Channel.ReadBasic.All`
- `offline_access`

Selon la politique du tenant, un administrateur peut devoir accorder le consentement. Démarrer ensuite l'application avec :

```bash
TEAMS_BOARD_CLIENT_ID="ID-DE-L-APPLICATION" npm start
```

Avec cette variable, le bouton de connexion utilise le flux Microsoft par code appareil. Les jetons sont conservés uniquement dans `data/auth.json`, avec des permissions de fichier restrictives.

## Fonctionnement

- Synchronisation automatique toutes les deux minutes.
- Seuls les messages actuellement chargés/rendus par Teams dans le navigateur peuvent être lus.
- Les nouveaux messages sont annoncés par une notification native Ubuntu lorsqu'ils sont détectés.
- Messages, réponses, classement, état traité/archivé et preuves sont conservés dans `data/state.json`.
- La vue affiche le nom de chaque conversation et place les messages Taskforce en premier.
- Chaque message peut être marqué traité individuellement ; le bouton de vue traite tous les messages ouverts de cette catégorie.
- Le premier import constitue la base sans lancer une analyse coûteuse de tout l'historique.
- Les nouvelles questions sont classées et analysées automatiquement.
- Codex est lancé avec `--sandbox read-only` et `--ephemeral` dans `/home/valm/IdeaProjects/phishing-coach` ou `/home/valm/IdeaProjects/academy`.
- La réponse et les fichiers de preuve sont affichés avant copie manuelle dans Teams.

Les sources, chemins des dépôts et options sont modifiables dans `config.json`.
