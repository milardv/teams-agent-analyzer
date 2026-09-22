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
- Les réponses d’un même fil Teams sont regroupées en flux de travail, avec le nombre de commentaires et l’historique du fil.
- Chaque flux reçoit des tags métier locaux comme `autom`, `smart simu`, `chapitre`, `jeu academy` ou `export csv`.
- Chaque message peut être marqué traité individuellement ; le bouton de vue traite tous les messages ouverts de cette catégorie.
- Le premier import constitue la base sans lancer une analyse coûteuse de tout l'historique.
- Les nouvelles questions sont classées et analysées automatiquement.
- Chaque retour est d’abord qualifié localement, sans appel modèle, comme question de fonctionnement ou bug ; un bug reçoit la criticité `bloquant` ou `gênant`.
- Les analyses Codex utilisent uniquement `gpt-5.6-luna` pour limiter la consommation de tokens.
- Codex est lancé avec `--sandbox read-only` et `--ephemeral` dans `/home/valm/IdeaProjects/phishing-coach` ou `/home/valm/IdeaProjects/academy`.
- La réponse et les fichiers de preuve sont affichés avant copie manuelle dans Teams ; « Copier et traiter » enchaîne les deux.
- La date d’un message lu dans le navigateur est déduite de son identifiant Teams (epoch en millisecondes), plus fiable que l’horodatage rendu, qui disparaît quand Teams regroupe plusieurs messages d’un même auteur. L’auteur manquant est hérité du message précédent du fil.
- Les auteurs listés dans `selfAuthors` (vous) ne génèrent pas de question à traiter, et un fil dont vous avez écrit le dernier message est affiché comme répondu.
- Le fil est affiché dans l’ordre chronologique, le dernier message est mis en évidence et la zone de réponse n’est pas rafraîchie pendant la saisie.
- Recherche plein texte (`/`), tri Taskforce d’abord / plus récents / plus anciens, raccourcis clavier (`?` pour la liste), pastille d’ancienneté des questions en attente.
- Quête du jour dans la barre latérale : niveau, objectif quotidien (cliquer pour le changer), série de jours et histogramme de la semaine ; confettis à l’inbox zéro.

Les sources, chemins des dépôts et options sont modifiables dans `config.json`.
