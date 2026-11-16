# IRC

Parlez à Gladys depuis [IRC](https://fr.wikipedia.org/wiki/Internet_Relay_Chat) (Libera.Chat, OFTC, votre
propre serveur…), avec n'importe quel client IRC (WeeChat, irssi, HexChat, The Lounge, Quassel, Goguma…),
comme avec le bot Telegram de Gladys : posez une question, lancez une scène, recevez les messages de Gladys.
L'intégration écrit aussi à des pseudos et dans des salons depuis vos scènes, et lance des scènes quand un
message ou une commande comme `!lumieres off` est écrit dans un salon où se trouve le robot.

> **Developed without the hardware: feedback welcome.** Développée sans le matériel : vos retours sont les
> bienvenus. L'intégration a été testée contre un vrai serveur IRC Ergo (TLS, SASL, salons, reconnexion),
> mais pas dans une vraie instance Gladys ni sur tous les réseaux. Dites ce qui marche et ce qui ne marche
> pas dans les [issues](https://github.com/guim31/gladys-irc/issues) ou sur le
> [forum Gladys](https://community.gladysassistant.com).

## Ce qu'il vous faut

- Gladys Assistant **5.1.0** ou plus récent.
- Un serveur IRC que Gladys peut joindre : un réseau public (Libera.Chat, OFTC…), votre propre serveur
  (Ergo, InspIRCd, UnrealIRCd…) ou un bouncer (ZNC).
- Un **pseudo enregistré pour le robot** auprès de NickServ (`/msg NickServ REGISTER <mot de passe> <email>`
  sur la plupart des réseaux), pour que personne d'autre ne le prenne et que le robot se connecte en SASL.
  Sur votre propre serveur sans services, aucun mot de passe n'est nécessaire.
- Le **compte de services** de chaque personne autorisée à parler au robot (son pseudo enregistré, comme
  `alice`) : le robot ne fait confiance à une personne que si le serveur indique qu'elle est connectée à ce
  compte. Sans services, un **masque** comme `alice!*@maison.example.org` convient aussi.

## Mise en place

1. Enregistrez le pseudo du robot sur votre réseau (connectez-vous une fois avec un client IRC sous ce pseudo,
   puis `/msg NickServ REGISTER …` ; Libera.Chat demande une confirmation par e-mail).
2. Dans Gladys, **Intégrations → IRC → Configuration** :
   - **Serveur** : un nom d'hôte, avec un port si besoin : `irc.libera.chat`, `irc.example.org:6697`,
     `192.168.1.20:6667` ou `ircs://irc.oftc.net`. Sans port : 6697 avec TLS, 6667 sans.
   - **Connexion chiffrée (TLS)** : activée par défaut ; laissez-la. Sans TLS, aucun mot de passe n'est
     jamais envoyé.
   - **Accepter un certificat auto-signé** : seulement pour votre propre serveur sur le réseau local, dont le
     certificat n'est pas signé par une autorité (Ergo crée un tel certificat). La connexion reste chiffrée,
     mais le serveur n'est pas vérifié. Désactivé par défaut.
   - **Pseudo du robot** : `Gladys` par défaut. S'il est pris, le robot essaie `Gladys_` puis `Gladys__`.
   - **Authentification** : **SASL** (la plupart des réseaux : Libera.Chat, OFTC, Ergo…), **NickServ** (le
     robot envoie `IDENTIFY` après sa connexion : réseaux plus anciens), **Mot de passe du serveur** (un
     bouncer comme ZNC, ou un serveur privé) ou **Aucune authentification**.
   - **Compte (facultatif)** : le compte de services du robot, s'il diffère de son pseudo. Pour ZNC :
     `utilisateur/réseau`.
   - **Mot de passe** : le mot de passe du compte (ou du serveur). Jamais écrit dans les journaux.
   - **Salons** : les salons que le robot rejoint, comme `#maison, #alertes`, séparés par des virgules. Leurs
     messages lancent des scènes.
   - **Personnes autorisées** : les comptes de services (`alice`) ou masques (`alice!*@maison.example.org`,
     `*` et `?` permis) que le robot écoute, séparés par des virgules. **Jamais un simple pseudo** : n'importe
     qui peut prendre un pseudo libre. **Vide, le robot ne répond à personne.**
   - **Préfixe des commandes** : `!` par défaut.
   - **Langue du robot** : la langue de ce que le robot écrit avant qu'une personne soit liée.
3. Cliquez sur **Tester la connexion** : le compte rendu donne le serveur et le pseudo du robot, les salons
   rejoints et le nombre de personnes autorisées. Le statut de connexion de la page l'indique aussi.

### Lier votre compte IRC pour parler à Gladys

Chaque utilisateur de Gladys qui veut lui parler depuis IRC le fait une fois :

1. Connectez-vous à votre compte sur le réseau (SASL ou NickServ, comme d'habitude), pour que le robot vous
   reconnaisse.
2. Dans Gladys, **Intégrations → IRC → Configuration**, bloc « Lier mon compte » : cliquez sur **Générer un
   code de liaison**.
3. Envoyez le code (8 caractères) au robot en message privé : `/msg Gladys ABCD2345`. Le robot confirme :
   votre compte est lié à votre utilisateur Gladys. Vous pouvez le délier depuis le même bloc.

## Ce que fait le robot

- **En conversation privée** (`/msg Gladys …` ou `/query Gladys`) : il transmet vos messages à Gladys, avec
  les droits de l'utilisateur Gladys lié, exactement comme le bot Telegram : « Quelle température fait-il dans
  le salon ? », « Éteins les lumières ». Les réponses de Gladys reviennent là, tout comme les messages que
  Gladys vous envoie (action de scène **Envoyer un message**, messages système).
- **Qui reçoit une réponse** : le robot écrit au pseudo sous lequel il vous a vu en dernier, après avoir
  vérifié par un WHOIS que ce pseudo est toujours vous (votre compte, ou votre masque). Si vous n'êtes pas
  connecté, ou si le pseudo appartient maintenant à quelqu'un d'autre, rien de privé n'est envoyé.
- **Dans un salon** : chaque message d'une personne autorisée lance le déclencheur **Message IRC reçu**, et
  un message qui commence par le préfixe lance aussi **Commande IRC reçue**. Le robot n'y répond jamais de
  lui-même, là où d'autres peuvent lire : la suite dépend de vos scènes.
- **Ce qu'il ignore** : toute personne qui n'est pas autorisée, ses propres messages, l'historique rejoué
  par un bouncer, les messages vieux de plus de 5 minutes quand il les reçoit (un « !ouvre garage » d'il y a
  deux heures ne s'exécute pas maintenant), et les salons où on l'a forcé à entrer (il les quitte).
- **Messages longs** : une ligne IRC contient environ 400 octets ; un message plus long est coupé entre les
  mots, et chaque saut de ligne du texte commence une nouvelle ligne, 10 lignes au plus. Pour ne pas être
  expulsé pour flood, le robot envoie 4 lignes d'un coup, puis une ligne toutes les 2 secondes.
- **Connexion** : quand elle tombe, le robot se reconnecte seul (après 2, 5, 10, 30 puis 60 secondes) et
  rejoint de nouveau ses salons. Un salon plein ou qui n'a pas répondu est retenté toutes les 2 minutes ;
  après une expulsion (kick), le robot reste dehors jusqu'à sa prochaine reconnexion ou un changement
  de configuration.

## Tableau de bord

Le widget **IRC** montre si le robot est connecté, son pseudo, les salons où il se trouve, les 5 derniers
messages des personnes autorisées dans les salons (pseudo, texte, date) et un bouton **Tester la connexion**.
Deux réglages masquent les messages et le bouton. Les conversations privées avec Gladys n'y apparaissent
jamais : tous ceux qui voient le tableau de bord voient le widget.

## Scènes

### Déclencheurs

- **Message IRC reçu** : une personne autorisée a écrit dans un salon du robot. Filtres (vide = tous) :
  **Salon** (`#maison`) et **Expéditeur** (le compte ou masque tel qu'écrit dans les personnes autorisées,
  `alice`). Variables : Message, Expéditeur, Pseudo, Salon.
- **Commande IRC reçue** : une personne autorisée a écrit une commande dans un salon : le préfixe, puis un
  mot, puis des arguments facultatifs, par exemple `!lumieres off cuisine`. Filtre **Commande** : le mot
  **sans le préfixe, en minuscules** (`lumieres`) ; et Salon, Expéditeur. Variables : Commande (`lumieres`),
  Arguments (`off cuisine`), Message, Expéditeur, Pseudo, Salon. Le même message lance aussi **Message IRC
  reçu**.
- **Connexion IRC perdue** : le robot ne joint plus le serveur, depuis une minute, ou son mot de passe ou le
  certificat du serveur sont refusés. Variable : Erreur. Lancé une fois, jusqu'au retour de la connexion.
- **Connexion IRC rétablie** : le robot joint de nouveau le serveur après une perte de connexion. Variable :
  Pseudo du robot.

### Actions

- **Envoyer un message IRC** : écrit un message à un pseudo (`alice`) ou dans un salon où se trouve le robot
  (`#maison`). Le message accepte les variables de scène. Résultats : Envoyé (oui/non), Erreur. Un message
  qui échoue n'arrête pas la scène : testez **Envoyé** par une condition si besoin. Un pseudo n'est pas vérifié : qui le
  détient reçoit le message, n'envoyez donc rien de privé ainsi.

Pour écrire à un utilisateur de Gladys plutôt qu'à un pseudo, utilisez l'action **Envoyer un message** de
Gladys : elle atteint son compte IRC lié, après la vérification par WHOIS.

### Idées de scènes

- **Garage par commande** : déclencheur **Commande IRC reçue**, commande `garage`, salon `#maison` ; puis une
  condition sur la variable Arguments égale à `ferme`, et l'action qui ferme le garage.
- **Lave-linge terminé** : déclencheur sur la puissance de la prise, puis **Envoyer un message IRC** à
  `#maison` : « Le lave-linge a terminé ».
- **Alerte quand le robot est coupé** : déclencheur **Connexion IRC perdue**, puis une notification par un
  autre canal (Gotify, ntfy, SMS) avec la variable Erreur.

## Dépannage

- **« le serveur IRC ne répond pas »** : vérifiez l'hôte et le port. La plupart des réseaux offrent le TLS
  sur 6697 ; `TLS sur un port en clair ?` signifie que le TLS a été parlé à un port qui ne l'a pas (souvent
  6667).
- **« certificat du serveur refusé »** : le certificat est auto-signé, expiré, ou ne nomme pas l'hôte saisi
  (utilisez le nom, pas l'adresse IP, d'un réseau public). Pour votre propre serveur sur le réseau local,
  cochez **Accepter un certificat auto-signé**.
- **« compte ou mot de passe refusé »** : vérifiez-les en vous connectant avec un client IRC. Le compte est
  le pseudo enregistré, ou **Compte (facultatif)** s'il diffère.
- **« le serveur ne propose pas SASL »** : choisissez **NickServ** dans **Authentification**.
- **« le robot est banni de ce réseau »** : certains réseaux refusent les connexions de certains hébergeurs
  ou exigent SASL depuis ces adresses ; voyez les règles du réseau.
- **Un salon n'est pas rejoint** : le statut de la page et le test le nomment, avec la raison (sur
  invitation, banni, clé requise, plein). Les salons à clé (+k) ne sont pas pris en charge : invitez le robot
  ou ajoutez-le à la liste d'accès du salon.
- **Le robot ne me répond pas** : êtes-vous connecté à votre compte (`/whois votrepseudo` affiche « is logged
  in as ») ? Votre compte est-il dans **Personnes autorisées**, écrit exactement ? Est-il lié (le robot vous
  donne alors les instructions) ?
- **Un message de salon ne lance pas la scène** : le serveur doit dire au robot qui est connecté (capacité
  IRCv3 `account-tag` : Libera.Chat, OFTC, Ergo, InspIRCd et UnrealIRCd l'ont) ; sinon, utilisez un masque.
  Le filtre Commande est le mot sans le préfixe, en minuscules : `lumieres`, pas `!Lumieres`.
- Plus de détails dans les journaux de l'intégration avec `LOG_LEVEL=debug`.

## Limites

- **Pas de chiffrement de bout en bout** : les messages circulent chiffrés entre votre client, le serveur et
  Gladys (TLS), mais le serveur IRC et ses opérateurs peuvent les lire, comme tous les présents d'un salon.
  Gardez les secrets hors des salons.
- Une personne liée à Gladys peut faire depuis IRC tout ce que peut son utilisateur Gladys : gardez la liste
  des personnes autorisées courte, protégez les comptes par des mots de passe solides, et préférez les
  comptes aux masques.
- Les images envoyées par Gladys (captures de caméra) ne sont pas transmises : seul le texte part. Fichiers
  et DCC sont ignorés.
- Un robot par Gladys et par réseau. Les salons à clé ne sont pas pris en charge.
- Sans lien avec aucun réseau IRC.
