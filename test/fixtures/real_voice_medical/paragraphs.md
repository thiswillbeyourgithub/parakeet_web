# Real-voice medical eval: 10 paragraphs to read

Ten short clinical dictation paragraphs in French, to be read aloud by a real human voice and
transcribed by three configurations:

1. `parakeet-tdt-0.6b-v3` (the multilingual baseline, Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx)
2. `parakeet-tdt-0.6b-v3-ultimed` (the French-medical fine-tune)
3. the same fine-tune plus phrase boosting with the curated `phrase_boosting/french_medical.pwc`
   list at Parakeet Web's default settings

Why it exists: every WER number published so far was measured on synthetic TTS audio produced by a
single voice. This set is the human-voice counterpart. It is deliberately made of plausible
consultation notes, not tongue twisters: the difficulty comes from drug brand names, acronyms and
eponyms that a general-purpose model has no reason to know, exactly the failure mode the fine-tune
targets (the canonical one being `actis que nan` instead of `ACTISKENAN`).

Written with Claude Code.

## How to record

- **One file per paragraph**, named `01.mp3` through `10.mp3`, dropped in this folder (`test/fixtures/real_voice_medical/`). Any format ffmpeg
  reads is fine (`.wav`, `.m4a`, `.flac`); the scoring script pairs a file to a paragraph by its
  leading number, not by its extension.
- Read **only the blockquoted text**. Do not read the headings, the "Traps" lines, or this section.
- Normal dictation pace, the way you would actually dictate a note. Not slow, not exaggerated
  articulation: the point is to measure real conditions.
- Quiet room, same microphone and same distance for all ten, so the three configurations are
  compared on identical audio and not on a moving recording setup.
- If you fluff a word, re-record the whole paragraph rather than patching it. A self-correction in
  the audio ("pardon, je reprends") counts as words the reference does not have and inflates WER for
  all three configurations equally, which is noise, not signal.

## Reading conventions

The paragraphs follow the spelling conventions of the UltiMed training targets, so the reference
text matches what the fine-tune is expected to emit:

- **Numbers are digits**, units are spelled out in full (`10 milligrammes`, not `10 mg`). Read them
  naturally: "dix milligrammes".
- **Brand names are in capitals** (`ACTISKENAN`, `ELIQUIS`), which is how they appear in the French
  open-data drug sources the dataset was built from. Read them as ordinary words, no spelling out.
  Scoring is case-insensitive, so the capitals cost nothing either way.
- **Acronyms are read letter by letter**: `BPCO` is "bé pé cé o", `ECBU` is "e cé bé u".

---

## 1. Antalgie, titration morphinique

> Monsieur Lefèvre, 62 ans, suivi pour un adénocarcinome pulmonaire métastatique, reste douloureux malgré le palier deux. On débute une titration par ACTISKENAN 10 milligrammes toutes les 4 heures, avec des interdoses en cas d'accès douloureux paroxystique. Dès que la dose efficace sera connue, on basculera sur du SKENAN LP en deux prises quotidiennes. Un laxatif osmotique est associé d'emblée, et la LAMALINE prescrite par le médecin traitant est arrêtée pour éviter le cumul d'opioïdes faibles et forts.

Traps: ACTISKENAN ("actis que nan"), SKENAN LP, LAMALINE, accès douloureux paroxystique, interdoses.

## 2. Cardiologie, relais d'anticoagulation

> Madame Bouchard, 78 ans, est hospitalisée pour une fibrillation atriale rapide découverte devant une dyspnée d'effort. Le traitement par PREVISCAN est remplacé par ELIQUIS 5 milligrammes matin et soir, après vérification de la clairance de la créatinine. Le KARDEGIC est arrêté, l'association n'apportant qu'un surcroît de risque hémorragique. Une échocardiographie transthoracique est demandée pour évaluer la fraction d'éjection ventriculaire gauche, et le cardiologue discutera d'une cardioversion après trois semaines d'anticoagulation efficace.

Traps: PREVISCAN, ELIQUIS, KARDEGIC, fibrillation atriale, échocardiographie transthoracique, cardioversion.

## 3. Diabétologie, intensification du traitement

> Le contrôle glycémique de monsieur Diallo reste insuffisant, avec une hémoglobine glyquée à 8,4 malgré la metformine à dose maximale. On introduit OZEMPIC 0,25 milligramme par semaine en sous-cutané, avec une majoration progressive à un mois, et on associe JARDIANCE 10 milligrammes le matin compte tenu de l'insuffisance cardiaque associée. Le débit de filtration glomérulaire est à 52 millilitres par minute, ce qui autorise encore la poursuite de la metformine. Un fond d'œil et un bilan podologique sont programmés.

Traps: OZEMPIC, JARDIANCE, metformine, hémoglobine glyquée, débit de filtration glomérulaire, decimals read aloud.

## 4. Pneumologie, BPCO

> Monsieur Nguyen présente une BPCO post-tabagique au stade GOLD trois, avec deux exacerbations l'an dernier. Le SYMBICORT est poursuivi et on ajoute SPIRIVA en inhalation quotidienne, après vérification de la technique de prise. La VENTOLINE reste en traitement de secours. Les épreuves fonctionnelles respiratoires seront refaites dans six mois, et une polygraphie ventilatoire est demandée devant une somnolence diurne évoquant un syndrome d'apnées obstructives du sommeil. Le sevrage tabagique est réabordé, avec une orientation vers la consultation de tabacologie.

Traps: BPCO (letter by letter), SYMBICORT, SPIRIVA, VENTOLINE, polygraphie ventilatoire, tabacologie.

## 5. Neurologie, épilepsie

> Cette patiente de 24 ans est suivie pour une épilepsie généralisée idiopathique. Sous KEPPRA 1000 milligrammes matin et soir, elle décrit une irritabilité importante et des troubles du sommeil. On propose une substitution progressive par LAMICTAL, avec une titration lente sur huit semaines pour limiter le risque de toxidermie. Le RIVOTRIL en gouttes reste disponible en cas de crise prolongée. Un électroencéphalogramme de contrôle et un dosage plasmatique sont prévus avant la prochaine consultation.

Traps: KEPPRA, LAMICTAL, RIVOTRIL, idiopathique, toxidermie, électroencéphalogramme.

## 6. Infectiologie, pyélonéphrite

> Madame Perrin consulte pour une pyélonéphrite aiguë simple, avec des douleurs lombaires droites et une fièvre à 39. L'ECBU retrouve un Escherichia coli sensible aux céphalosporines de troisième génération. On débute de la ROCEPHINE en intramusculaire pendant 48 heures, avec un relais par TAVANIC selon l'antibiogramme. L'AUGMENTIN initialement prescrit est arrêté. En cas d'allergie documentée aux bêtalactamines, la PYOSTACINE aurait été une alternative, mais elle n'a pas d'indication urinaire ici.

Traps: ECBU (letter by letter), Escherichia coli, ROCEPHINE, TAVANIC, AUGMENTIN, PYOSTACINE, bêtalactamines, antibiogramme.

## 7. Gastro-entérologie, maladie de Crohn

> Ce jeune homme de 29 ans est suivi pour une maladie de Crohn iléo-colique diagnostiquée il y a quatre ans. La calprotectine fécale est remontée et la coloscopie retrouve des ulcérations creusantes de la dernière anse iléale. L'IMUREL seul ne suffit plus, on introduit donc l'HUMIRA en injections sous-cutanées toutes les deux semaines, après bilan pré-thérapeutique et recherche de tuberculose latente. L'INEXIUM est maintenu pour un reflux gastro-œsophagien associé, et une supplémentation martiale est débutée.

Traps: IMUREL, HUMIRA, INEXIUM, calprotectine fécale, iléo-colique, anse iléale, gastro-œsophagien.

## 8. Rhumatologie, spondylarthrite

> Monsieur Carvalho, 41 ans, est adressé pour des lombalgies inflammatoires évoluant depuis deux ans, avec un dérouillage matinal prolongé. L'IRM des sacro-iliaques confirme une sacro-iliite bilatérale, et le diagnostic de spondylarthrite axiale est retenu. Les AINS sont insuffisamment efficaces, on envisage donc un anti-TNF alpha après avis du rhumatologue. Le méthotrexate n'a pas d'intérêt sur l'atteinte axiale. Une ostéodensitométrie et un bilan de son syndrome de Gougerot-Sjögren associé complètent la prise en charge.

Traps: sacro-iliite, spondylarthrite, AINS, anti-TNF alpha, méthotrexate, ostéodensitométrie, Gougerot-Sjögren.

## 9. Psychiatrie, trouble dépressif récurrent

> Madame Ferreira, 55 ans, est suivie pour un trouble dépressif récurrent. Sous DEROXAT 20 milligrammes, la rémission n'est que partielle et l'anxiété reste invalidante. On majore à 30 milligrammes et on introduit XEROQUEL à faible dose le soir, en expliquant la somnolence des premiers jours. Le LEXOMIL pris depuis huit mois doit être diminué très progressivement, le sevrage brutal exposant à un rebond anxieux et à un risque comitial. Une psychothérapie de soutien est réengagée en parallèle.

Traps: DEROXAT, XEROQUEL, LEXOMIL, comitial, rebond anxieux.

## 10. Chirurgie digestive et imagerie

> Cette patiente de 63 ans a été opérée d'une cholécystectomie sous cœlioscopie avec exploration de la voie biliaire principale. Le drain de Kehr a été retiré au dixième jour. Elle reconsulte aujourd'hui pour un ictère fébrile, avec une cytolyse et une cholestase marquées. La tomodensitométrie abdomino-pelvienne injectée évoque une lithiase résiduelle du cholédoque, confirmée par la cholangio-pancréatographie rétrograde endoscopique, qui permet dans le même temps une sphinctérotomie et l'extraction du calcul. L'évolution est favorable sous antibiothérapie.

Traps: cholécystectomie, cœlioscopie, drain de Kehr, cholangio-pancréatographie rétrograde endoscopique, sphinctérotomie, cholédoque.

---

## What will be measured

Per paragraph and over the whole set, for each of the three configurations:

- **WER** and **CER** against the blockquoted reference, normalised the way `scripts/wer-quants.py`
  does it (NFC, lowercase, punctuation stripped, whitespace collapsed, diacritics kept).
- A **per-term hit or miss** table over the "Traps" terms above. This is the part that carries the
  story for a README: an average WER hides the fact that the baseline turns one specific brand name
  into three wrong words every single time.

The three configurations differ only in the model and the boosting flags. Encoder quantisation,
decoder quantisation, chunking, beam width and the backend are held fixed across all three.
