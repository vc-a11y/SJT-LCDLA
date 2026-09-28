# Test savoir-être · Les clés de l'Atelier

Test de jugement situationnel (SJT) en ligne pour attribuer le **macaron savoir-être** aux candidats.

- **Candidat** : reçoit un lien personnel, passe 24 situations de chantier sur mobile (meilleure réaction, puis moins adaptée). Il ne voit pas son score.
- **Responsable de formation** : crée les liens, voit le score, le radar des 6 compétences, les alertes, les questions à creuser en entretien, puis décide (macaron accordé, différé ou refusé).
- **Entreprise** : reçoit un lien vers une fiche d'une page imprimable en PDF, uniquement si le macaron est accordé.

Le score est un **calcul fixe** (barème dans `data/questions.json`). L'IA n'attribue jamais le macaron. Elle peut seulement rédiger la synthèse (option).

## Tester en local

```bash
npm install
cp .env.example .env        # puis modifiez ADMIN_PASSWORD et SESSION_SECRET
node --env-file=.env server.js
```

Ouvrez http://localhost:3000/admin. Sans `DATABASE_URL`, les données sont stockées dans `.data/candidates.json` (développement uniquement).

`npm test` lance les tests du parcours complet (création, test, alerte, décision, fiche, nouveau passage).

## Mettre en ligne (GitHub + Render)

1. Créez un dépôt **privé** sur GitHub et déposez ce dossier :
   ```bash
   git init && git add . && git commit -m "Test savoir-être"
   git branch -M main
   git remote add origin https://github.com/VOTRE-ORGANISATION/cles-savoir-etre.git
   git push -u origin main
   ```
2. Sur Render : **New > Blueprint**, choisissez le dépôt. Render lit `render.yaml` et crée le service web et la base PostgreSQL (région Frankfurt).
3. Renseignez `ADMIN_PASSWORD` quand Render le demande (ou `ADMIN_USERS`, voir ci-dessous). `SESSION_SECRET` est généré automatiquement.
4. Une fois déployé, ouvrez `https://VOTRE-SERVICE.onrender.com/admin`.
5. Chaque `git push` sur `main` redéploie automatiquement.

Vérifiez dans Render les noms de plans et les tarifs du service (`starter`) et de la base (`basic-256mb`) : ils peuvent avoir changé. Évitez le plan gratuit du service (mise en veille lente pour un candidat qui clique sur son lien) et de la base (suppression après une période limitée).

Pour un nom de domaine propre (par exemple `test.lesclesdelatelier.fr`), ajoutez un domaine personnalisé dans les réglages du service Render.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Fournie par Render. Absente = stockage fichier (dev). |
| `ADMIN_PASSWORD` | Mot de passe partagé ; chacun saisit son prénom à la connexion. |
| `ADMIN_USERS` | Alternative nominative : `Tanya:mdp1,Hélène:mdp2`. Remplace `ADMIN_PASSWORD`. |
| `SESSION_SECRET` | Signature des sessions (généré par Render). |
| `ANTHROPIC_API_KEY` | Optionnel. Active « Rédiger avec Claude ». Seuls les scores sont envoyés, jamais le nom. |
| `ANTHROPIC_MODEL` | Optionnel. Modèle utilisé pour la synthèse. |
| `ALERT_MIN` | Nombre de réponses dangereuses qui déclenche l'alerte (1 par défaut). |
| `RETENTION_MONTHS` | Durée de conservation des dossiers (24 par défaut), suppression automatique. |
| `QUESTION_SECONDS` | Temps laissé au candidat par étape (meilleure/moins adaptée), en secondes (60 par défaut). |
| `REMINDER_DAYS` | Jours sans passage (depuis l'envoi ou la dernière relance) avant qu'un candidat apparaisse « à relancer » (2 par défaut). |

## Modifier les questions

Tout est dans `data/questions.json` : 6 compétences, 36 situations (6 par compétence). Chaque test en tire 4 par compétence, soit 24, dans un ordre aléatoire, avec les options mélangées.

- `q` : qualité de l'option, de 0 (mauvaise) à 3 (idéale). Chaque situation doit avoir au moins une option à 3 et une à 0.
- `d: 1` : option dangereuse (sécurité) ou malhonnête. La choisir comme « meilleure » déclenche une alerte.
- Points par situation : `q` de la meilleure réponse choisie + (3 − `q` de la réponse choisie comme pire) = 0 à 6.

Ajoutez des situations pour élargir la banque (60 à 80 est idéal pour limiter la circulation des réponses). `npm test` vérifie la structure.

## Règles de décision

Réglages dans `lib/scoring.js` (objet `RULES`) :

- seuil 70, excellence 85 ;
- compétence « faible » sous 60 %, « forte » à partir de 85 % ;
- test passé en moins de 4 minutes signalé comme « très rapide » ;
- validité du label : 12 mois.

**À calibrer après un pilote** : passez le test à 15 ou 20 anciens stagiaires (dont des profils que vous connaissez bien), regardez la distribution des scores et le nombre d'alertes, puis ajustez le seuil et `ALERT_MIN`. Une réponse au hasard donne environ 55 %.

## Passages multiples, relance et reformulation

- **Nouveau passage** : le bouton « Autoriser un nouveau passage » conserve désormais le résultat précédent dans un historique visible sur la fiche du candidat (score, réponses, décision de chaque tentative), au lieu de l'effacer.
- **Relance** : un candidat sans test terminé depuis plus de `REMINDER_DAYS` jours (2 par défaut, depuis l'envoi ou depuis la dernière relance) apparaît avec un badge « À relancer » sur le tableau de bord et sur sa fiche. Le bouton « Relancer » ouvre un **brouillon Gmail** pré-rempli (pas Outlook) et enregistre la date de relance — le cycle recommence ensuite tous les `REMINDER_DAYS` jours tant que le candidat n'a pas répondu. **Il ne s'agit pas d'un envoi automatique invisible** : quelqu'un doit cliquer sur « Envoyer » dans Gmail. Un vrai envoi automatique sans intervention humaine nécessiterait de connecter le compte Gmail de LCDLA via l'autorisation officielle de Google (OAuth), non fait ici à la demande explicite.
- **Reformulation** : chaque situation a un bouton « Reformuler la question » qui affiche une version en phrases plus courtes et plus simples (utile pour les candidats FLE). Les textes reformulés sont dans le champ `ts` de `data/questions.json`, à adapter/enrichir librement.

## Couleurs, logo, textes

- Les couleurs sont des variables en tête de `public/css/app.css`. Le gris ardoise (`#636565`) est celui du logo. Le jaune de chantier (`#f2b705`) est un choix de départ à remplacer par la couleur d'accent du site si elle est différente.
- Le logo est dans `public/img/`. Le fond du bandeau reprend exactement le gris du logo.
- Texte d'explication du label sur la fiche entreprise : `public/js/fiche.js`. Adaptez-le à votre processus réel (entretien, mise en situation, observation).

## RGPD

- Consentement recueilli avant le test et horodaté.
- Suppression automatique après `RETENTION_MONTHS`, suppression manuelle possible depuis chaque dossier, export CSV.
- Le lien entreprise n'existe que si le macaron est accordé et expire après 12 mois.
- Complétez la politique de confidentialité (finalités, durée, droits, sous-traitants : Render, et Anthropic si vous activez la synthèse) et inscrivez le traitement au registre.

## Structure

```
server.js            API et pages
lib/scoring.js       tirage des questions, barème, règles
lib/db.js            PostgreSQL ou fichier JSON
lib/auth.js          connexion des responsables
lib/synthesis.js     synthèse automatique et option Claude
data/questions.json  banque de situations
public/              pages, styles, logo
test/flow.test.js    tests du parcours
render.yaml          configuration Render
```
