import React, { createContext, useContext, useState, useEffect } from 'react';

const translations = {
  en: {
    // Header
    status: 'Status',

    // Status messages
    idle: 'Idle',
    loadingModel: 'Loading model\u2026',
    creatingSessions: 'Creating sessions\u2026',
    compilingModel: 'Compiling model\u2026',
    modelReady: 'Model ready \u2714',
    hfUnreachable: 'HuggingFace appears unreachable',
    failed: 'Failed',
    startingRecording: 'Starting recording...',
    recordingStartsNow: 'Recording starts now!',
    recordingClickStop: 'Recording... (click Stop to transcribe)',
    recordingPaused: 'Recording paused \u23f8',
    transcriptionFailed: 'Transcription failed',
    processingPreview: 'Processing audio preview...',

    // Buttons
    loadModel: 'Load Model',
    sendMp3: '\ud83d\udcc1 Send mp3',
    recordAudio: '\ud83c\udfa4 Record Audio',
    getReady: '\u23f1 Get Ready',
    stop: '\u23f9 Stop',
    resume: '\u25b6 Resume',
    pause: '\u23f8 Pause',
    remoteMic: 'Phone Mic (Beta)',
    remoteMicTitle: 'Remote Microphone',
    remoteMicTooltip: 'Use your phone as a microphone via WebRTC',
    remoteMicConnecting: 'Setting up connection...',
    remoteMicScanQr: 'Scan this QR code with your phone',
    remoteMicWaiting: 'Waiting for phone to connect...',
    remoteMicRecording: 'Recording from phone',
    remoteMicStop: 'Stop & Transcribe',
    remoteMicDisconnected: 'Phone disconnected',
    remoteMicRegenerateQr: 'Regenerate QR Code',
    remoteMicDisconnectPhone: 'Disconnect Phone',
    remoteMicConnectedIdle: 'Phone connected \u2014 waiting for recording',
    remoteMicError: 'Remote microphone error',
    cancel: 'Cancel',
    close: 'Close',
    transcribe: '\ud83c\udfaf Transcribe',
    transcribing: 'Transcribing...',
    raw: 'Raw',
    confidence: 'Confidence',
    dictationExp: 'Dictation (exp.)',
    dismiss: 'Dismiss',
    downloadFromServer: 'Download from this server',
    clearTranscriptionHistory: 'Clear Transcription History',
    resetAllSettingsAndData: '\u26a0\ufe0f Reset All Settings and Data',
    showKeyboardShortcuts: 'Show Keyboard Shortcuts',
    hideKeyboardShortcuts: 'Hide Keyboard Shortcuts',
    connectDictationDevice: '\ud83c\udfa4 Connect Dictation Device',
    connectedDevice: '\ud83c\udfa4 Connected',

    // Recording UI
    recordingInProgress: '\ud83d\udd34 Recording in progress... Click "Stop" when done, or "Pause" to take a break (P key).',
    recordingPausedMsg: '\u23f8 Recording paused. Click "Resume" to continue or "Stop" to finish.',
    getReadyToSpeak: '\u23f1 Get ready to speak in',
    tooQuiet: '\ud83d\udd07 Too quiet - speak louder',
    speakLouder: '\ud83d\udd09 Speak a bit louder',
    goodLevel: '\ud83d\udd0a Good level',

    // Audio preview
    processingAudioPreview: '\u23f3 Processing audio preview...',
    whatModelHears: '(16kHz mono - what the model hears)',
    clearAudioFile: 'Clear audio file',

    // Settings
    model: 'Model',
    backend: 'Backend',
    wasmCpu: 'WASM (CPU)',
    webgpu: 'WebGPU',
    encoderQuantization: 'Encoder Quantization',
    decoderQuantization: 'Decoder Quantization',
    int8Faster: 'int8 (faster)',
    fp32HigherQuality: 'fp32 (higher quality)',
    frameStride: 'Frame Stride',
    cpuThreads: 'CPU Threads',
    temperature: 'Temperature',
    chunkLongAudio: 'Chunk long audio',
    chunkDuration: 'Chunk duration',
    showCertaintyHeatmap: 'Show Certainty Heatmap',
    defaultTranscriptDisplay: 'Default transcript display',
    dictationRules: 'Dictation',
    dictationRulesExperimental: 'rules) \u2014 experimental',
    autoTranscribeAfterRecording: 'Auto-transcribe after recording',
    autoCopyToClipboard: 'Auto-copy transcribed text to clipboard',
    displayMoreDetails: 'Display more details',
    maxDebugVerbosity: 'Maximum devtools debug log verbosity',
    audioProcessing: 'Audio Processing',
    noiseSuppression: 'Noise Suppression',
    echoCancellation: 'Echo Cancellation',
    autoGainControl: 'Auto Gain Control',

    // Tooltips
    tooltipBackend: 'WASM (CPU) is more compatible. WebGPU uses GPU for faster processing but requires modern browsers.',
    tooltipQuantization: 'int8 uses 8-bit integers for faster processing with slightly reduced quality. fp32 uses 32-bit floats for highest quality but slower.',
    tooltipFrameStride: 'Number of frames to skip during decoding. Higher values are faster but may reduce accuracy. Recommended: 1-2 for best quality, 3-4 for speed.',
    tooltipCpuThreads: 'Number of CPU threads to use for processing. More threads = faster, but limited by your CPU cores. Recommended: leave 1-2 cores free for the browser.',
    tooltipTemperature: 'Decoder softmax temperature. Lower values (0.0-1.0) produce more confident/greedy output. Higher values (1.2-2.0) allow more diversity. Default: 0.0',
    tooltipChunking: 'Split audio longer than the chunk duration into overlapping segments before transcribing. Disable to send the full audio to the model in one pass (may use more memory but avoids chunk boundary issues).',
    tooltipHeatmap: 'Highlights words with color-coded backgrounds based on transcription confidence. Red = low confidence, yellow = medium, green = high.',
    tooltipDisplayMode: 'Choose how transcriptions are displayed by default. Raw = unmodified text. Confidence = word-level confidence heatmap. Dictation = text cleaned with regex rules (punctuation, medical vocab, etc.).',
    tooltipAutoTranscribe: 'Automatically starts transcription when a recording is stopped. Disable to review the audio before transcribing.',
    tooltipAutoCopy: 'Automatically copies text to clipboard after transcription. Copies the dictation-cleaned transcript when display mode is set to Dictation (and rules are loaded), otherwise copies raw text.',
    tooltipAdvancedInfo: 'Displays system memory/heap usage, per-transcription performance metrics (RTF, timings), and detailed audio metadata.',
    tooltipVerboseLog: 'Enables the most detailed logging level in the browser devtools console. Useful for debugging or performance analysis.',
    tooltipNoiseSuppression: 'Reduces background noise for clearer voice. Disable for music or when maximum audio fidelity is needed.',
    tooltipEchoCancellation: 'Removes echo and feedback. Disable for music recording or if you experience audio quality issues.',
    tooltipAutoGainControl: 'Automatically adjusts volume levels. Disable for music or when you want consistent volume.',

    // About / info section
    about: 'About',
    aboutTitle: 'About ParakeetWeb',
    privacyEmphasis: '100% private & local — your audio never leaves your device, no server, no cloud.',
    tagline: 'Dictation for any language, without installing anything!',
    whatIsThis: 'What is this?',
    infoDescription1: 'ParakeetWeb is a browser-based speech-to-text application that runs entirely in your browser using WebAssembly and WebGPU. Your audio never leaves your device - all processing happens locally on your computer.',
    infoDescription2: "It uses NVIDIA's Parakeet TDT model for high-quality transcription with word-level timestamps and confidence scores. You can transcribe audio files or record directly from your microphone.",
    sourceCode: 'Source code',
    feedback: 'Feedback',
    feedbackText: 'If you have any complaint or feedback, you can reach out at',
    orDirectlyBy: 'or directly by',
    openingAnIssue: 'opening an issue',
    onTheGitHubRepo: 'on the GitHub repository.',
    install: 'Install',
    installText: 'You can install ParakeetWeb as a PWA (Progressive Web App) from your browser for quick, app-like access.',
    privacy: 'Privacy',
    privacyText: 'This app uses privacy-respecting analytics provided by a self-hosted',
    privacyText2: 'instance. No personal data is collected, and no cookies are used for tracking.',

    // Keyboard shortcuts
    keyboardShortcuts: 'Keyboard Shortcuts',
    shortcutToggleSettings: 'Toggle settings panel',
    shortcutStopRecording: 'Stop recording (while recording)',
    shortcutStartRecording: 'Start recording',
    shortcutSelectFile: 'Select audio file',
    shortcutTranscribe: 'Start transcription',
    shortcutLoadModel: 'Load model',
    shortcutsDisabledInInputs: 'Shortcuts are disabled while typing in input fields.',

    // Transcriptions
    transcriptions: 'Transcriptions',
    copied: '\u2713 Copied',
    copyText: '\ud83d\udccb Copy text',
    copyDictation: '\u2728 Copy dictation',
    delete: '\ud83d\uddd1\ufe0f Delete',

    // Warnings
    devModeBanner: '\u26a0\ufe0f Development version \u2014 this instance is under active development. Expect bugs, instability, and frequent changes.',
    lowRamWarning: '\u26a0\ufe0f Your device may have limited memory',
    lowRamModelMayFail: '. The speech recognition model (~100\u2013200 MB) might fail to load.',
    sharedArrayBufferWarning: '\u26a0\ufe0f Performance Note: SharedArrayBuffer is not available. WASM will run single-threaded. For better performance, serve over HTTPS with proper headers or use WebGPU.',

    // Fallback prompt
    couldNotReachHF: 'Could not reach HuggingFace to download model weights.',
    localCopyAvailable: 'This instance has a local copy of the weights \u2014 would you like to use it instead?',
    localFallbackNotEnabled: 'Local fallback is not enabled on this instance.',

    // System info
    system: '\ud83d\udcbe System',
    ram: 'RAM',
    heap: 'Heap',
    high: '\u26a0\ufe0f High',
    cpu: 'CPU',
    fps: 'FPS',
    lowFps: '\u26a0\ufe0f Low FPS',
    storage: 'Storage',

    // Performance
    rtf: 'RTF',
    total: 'Total',
    preprocess: 'Preprocess',
    encode: 'Encode',
    decode: 'Decode',
    tokenize: 'Tokenize',

    // Misc
    help: 'Help',
    moreActions: 'More actions',
    toggleInfo: 'Toggle info',
    hideInfo: 'Hide info',
    showInfo: 'Show info',
    toggleSettings: 'Toggle settings',
    hideSettings: 'Hide settings',
    showSettings: 'Show settings',
    closeSettings: 'Close settings',

    // Reset confirm
    resetConfirmTitle: '\u26a0\ufe0f This will permanently delete ALL saved settings and transcription history.',
    resetConfirmQuestion: 'Are you sure you want to continue?',
    resetFailed: 'Failed to reset data. Please check the console for details.',
    loadModelFirst: 'Load model first',
    failedCopyClipboard: 'Failed to copy to clipboard',

    // Dictation device
    dictationDevice: 'Dictation device',
    dictationDeviceHint: 'RECORD = start/pause/resume \u00b7 STOP = stop recording',

    // Transcribing status
    transcribingFile: 'Transcribing',
    processingResampling: 'Processing - Resampling audio...',
    resamplingTo16k: '\u23f3 Resampling to 16kHz...',
    complete: 'complete',
    chunk: 'chunk',

    // Language
    language: 'Language',

    // Mobile remote-mic page
    mobileTitle: 'ParakeetWeb Remote Mic',
    mobileInitializing: 'Initializing...',
    mobileConnecting: 'Connecting to computer...',
    mobileEstablishingEncryption: 'Establishing encryption...',
    mobileRecording: 'Recording',
    mobilePaused: 'Paused',
    mobilePauseBtn: '\u23f8 Pause',
    mobileResumeBtn: '\u25b6 Resume',
    mobileStopBtn: '\u23f9 Stop & Send',
    mobileDisconnectBtn: 'Disconnect',
    mobileStartNewBtn: '\u25cf Start New Recording',
    mobileRecordingSent: 'Recording sent to computer.',
    mobileStartAnother: 'Start another recording or disconnect.',
    mobileSessionEnded: 'Connection ended.',
    mobileSessionEndedHint: 'To reconnect, click \u201cRegenerate QR Code\u201d on your computer, then scan the new QR code with your phone\u2019s camera app.',
    mobileNoAudio: 'No audio detected',
    mobileSpeakLouder: 'Speak louder',
    mobileGoodLevel: 'Audio level good',
    mobileDebugLogs: 'Debug logs',
    mobileOpenMenu: '\u2261',
    mobileCloseMenu: '\u00d7 Close',
    mobileLanguageHeading: 'Language',
    mobileAboutHeading: 'About',
    mobileAboutBlurb: 'ParakeetWeb is a local-first, open-source speech-to-text tool that runs entirely in your browser. No audio leaves your device. Built with Claude Code.',
    mobileOpenSource: 'View on GitHub (open source)',
    mobileInvalidLink: 'Invalid link. Please scan the QR code again.',
    mobileInvalidLinkMissing: 'Invalid link. Missing room ID or secret.',
    mobileMicDenied: 'Microphone access denied. Please grant permission and try again.',
    mobileMicFailed: 'Failed to capture microphone: ',
    mobileRescanHint: 'Scan the new QR code shown on your computer with your phone\u2019s camera app to start a new session.',
    mobileConnectedReady: 'Connected. Tap Start Recording when ready.',
    mobileConfirmDisconnectTitle: 'Disconnect?',
    mobileConfirmDisconnectBody: 'This will end the session. You\u2019ll need to scan a new QR code to reconnect.',
    mobileConfirmDisconnectYes: 'Yes, disconnect',
    mobileConfirmDisconnectNo: 'Cancel',
  },
  fr: {
    // Header
    status: 'Statut',

    // Status messages
    idle: 'En attente',
    loadingModel: 'Chargement du mod\u00e8le\u2026',
    creatingSessions: 'Cr\u00e9ation des sessions\u2026',
    compilingModel: 'Compilation du mod\u00e8le\u2026',
    modelReady: 'Mod\u00e8le pr\u00eat \u2714',
    hfUnreachable: 'HuggingFace semble inaccessible',
    failed: '\u00c9chec',
    startingRecording: "D\u00e9marrage de l'enregistrement...",
    recordingStartsNow: "L'enregistrement commence maintenant\u00a0!",
    recordingClickStop: 'Enregistrement... (cliquez Stop pour transcrire)',
    recordingPaused: 'Enregistrement en pause \u23f8',
    transcriptionFailed: '\u00c9chec de la transcription',
    processingPreview: "Traitement de l'aper\u00e7u audio...",

    // Buttons
    loadModel: 'Charger le mod\u00e8le',
    sendMp3: '\ud83d\udcc1 Envoyer un mp3',
    recordAudio: '\ud83c\udfa4 Enregistrer',
    getReady: '\u23f1 Pr\u00e9parez-vous',
    stop: '\u23f9 Stop',
    resume: '\u25b6 Reprendre',
    pause: '\u23f8 Pause',
    remoteMic: 'Micro tel. (Beta)',
    remoteMicTitle: 'Microphone distant',
    remoteMicTooltip: 'Utiliser votre telephone comme micro via WebRTC',
    remoteMicConnecting: 'Connexion en cours...',
    remoteMicScanQr: 'Scannez ce QR code avec votre telephone',
    remoteMicWaiting: 'En attente du telephone...',
    remoteMicRecording: 'Enregistrement depuis le telephone',
    remoteMicStop: 'Stop & Transcrire',
    remoteMicDisconnected: 'T\u00e9l\u00e9phone d\u00e9connect\u00e9',
    remoteMicRegenerateQr: 'R\u00e9g\u00e9n\u00e9rer le QR Code',
    remoteMicDisconnectPhone: 'D\u00e9connecter le t\u00e9l\u00e9phone',
    remoteMicConnectedIdle: 'T\u00e9l\u00e9phone connect\u00e9 \u2014 en attente d\u2019enregistrement',
    remoteMicError: 'Erreur microphone distant',
    cancel: 'Annuler',
    close: 'Fermer',
    transcribe: '\ud83c\udfaf Transcrire',
    transcribing: 'Transcription en cours...',
    raw: 'Brut',
    confidence: 'Confiance',
    dictationExp: 'Dict\u00e9e (exp.)',
    dismiss: 'Fermer',
    downloadFromServer: 'T\u00e9l\u00e9charger depuis ce serveur',
    clearTranscriptionHistory: "Effacer l'historique des transcriptions",
    resetAllSettingsAndData: '\u26a0\ufe0f R\u00e9initialiser tous les param\u00e8tres et donn\u00e9es',
    showKeyboardShortcuts: 'Afficher les raccourcis clavier',
    hideKeyboardShortcuts: 'Masquer les raccourcis clavier',
    connectDictationDevice: '\ud83c\udfa4 Connecter un appareil de dict\u00e9e',
    connectedDevice: '\ud83c\udfa4 Connect\u00e9',

    // Recording UI
    recordingInProgress: '\ud83d\udd34 Enregistrement en cours... Cliquez "Stop" quand vous avez termin\u00e9, ou "Pause" pour faire une pause (touche P).',
    recordingPausedMsg: '\u23f8 Enregistrement en pause. Cliquez "Reprendre" pour continuer ou "Stop" pour terminer.',
    getReadyToSpeak: '\u23f1 Pr\u00e9parez-vous \u00e0 parler dans',
    tooQuiet: '\ud83d\udd07 Trop faible - parlez plus fort',
    speakLouder: '\ud83d\udd09 Parlez un peu plus fort',
    goodLevel: '\ud83d\udd0a Bon niveau',

    // Audio preview
    processingAudioPreview: "\u23f3 Traitement de l'aper\u00e7u audio...",
    whatModelHears: "(16kHz mono - ce que le mod\u00e8le entend)",
    clearAudioFile: "Supprimer le fichier audio",

    // Settings
    model: 'Mod\u00e8le',
    backend: 'Moteur',
    wasmCpu: 'WASM (CPU)',
    webgpu: 'WebGPU',
    encoderQuantization: "Quantification de l'encodeur",
    decoderQuantization: 'Quantification du d\u00e9codeur',
    int8Faster: 'int8 (plus rapide)',
    fp32HigherQuality: 'fp32 (meilleure qualit\u00e9)',
    frameStride: 'Pas de trame',
    cpuThreads: 'Threads CPU',
    temperature: 'Temp\u00e9rature',
    chunkLongAudio: "D\u00e9couper l'audio long",
    chunkDuration: 'Dur\u00e9e des segments',
    showCertaintyHeatmap: 'Afficher la carte de certitude',
    defaultTranscriptDisplay: 'Affichage par d\u00e9faut',
    dictationRules: 'Dict\u00e9e',
    dictationRulesExperimental: 'r\u00e8gles) \u2014 exp\u00e9rimental',
    autoTranscribeAfterRecording: "Transcrire automatiquement apr\u00e8s l'enregistrement",
    autoCopyToClipboard: 'Copier automatiquement le texte dans le presse-papiers',
    displayMoreDetails: 'Afficher plus de d\u00e9tails',
    maxDebugVerbosity: 'Verbosit\u00e9 maximale des logs de d\u00e9bogage',
    audioProcessing: 'Traitement audio',
    noiseSuppression: 'Suppression du bruit',
    echoCancellation: "\u00c9limination de l'\u00e9cho",
    autoGainControl: 'Contr\u00f4le automatique du gain',

    // Tooltips
    tooltipBackend: "WASM (CPU) est plus compatible. WebGPU utilise le GPU pour un traitement plus rapide mais n\u00e9cessite un navigateur r\u00e9cent.",
    tooltipQuantization: 'int8 utilise des entiers 8 bits pour un traitement plus rapide avec une qualit\u00e9 l\u00e9g\u00e8rement r\u00e9duite. fp32 utilise des flottants 32 bits pour la meilleure qualit\u00e9 mais plus lent.',
    tooltipFrameStride: "Nombre de trames \u00e0 sauter pendant le d\u00e9codage. Des valeurs plus \u00e9lev\u00e9es sont plus rapides mais peuvent r\u00e9duire la pr\u00e9cision. Recommand\u00e9\u00a0: 1-2 pour la qualit\u00e9, 3-4 pour la vitesse.",
    tooltipCpuThreads: "Nombre de threads CPU \u00e0 utiliser. Plus de threads = plus rapide, mais limit\u00e9 par vos c\u0153urs CPU. Recommand\u00e9\u00a0: laisser 1-2 c\u0153urs libres pour le navigateur.",
    tooltipTemperature: "Temp\u00e9rature softmax du d\u00e9codeur. Des valeurs basses (0.0-1.0) produisent une sortie plus s\u00fbre. Des valeurs hautes (1.2-2.0) permettent plus de diversit\u00e9. D\u00e9faut\u00a0: 0.0",
    tooltipChunking: "D\u00e9coupe l'audio plus long que la dur\u00e9e du segment en morceaux chevauchants avant la transcription. D\u00e9sactivez pour envoyer l'audio complet au mod\u00e8le en une passe.",
    tooltipHeatmap: 'Colore les mots selon la confiance de la transcription. Rouge = faible confiance, jaune = moyen, vert = \u00e9lev\u00e9.',
    tooltipDisplayMode: "Choisissez l'affichage par d\u00e9faut. Brut = texte non modifi\u00e9. Confiance = carte de confiance par mot. Dict\u00e9e = texte nettoy\u00e9 par r\u00e8gles regex.",
    tooltipAutoTranscribe: "D\u00e9marre automatiquement la transcription \u00e0 l'arr\u00eat de l'enregistrement. D\u00e9sactivez pour r\u00e9\u00e9couter avant de transcrire.",
    tooltipAutoCopy: "Copie automatiquement le texte dans le presse-papiers apr\u00e8s la transcription. Copie le texte nettoy\u00e9 en mode Dict\u00e9e si les r\u00e8gles sont charg\u00e9es.",
    tooltipAdvancedInfo: "Affiche l'utilisation m\u00e9moire, les m\u00e9triques de performance par transcription et les m\u00e9tadonn\u00e9es audio d\u00e9taill\u00e9es.",
    tooltipVerboseLog: "Active le niveau de log le plus d\u00e9taill\u00e9 dans la console du navigateur. Utile pour le d\u00e9bogage.",
    tooltipNoiseSuppression: "R\u00e9duit le bruit de fond pour une voix plus claire. D\u00e9sactivez pour la musique ou pour une fid\u00e9lit\u00e9 audio maximale.",
    tooltipEchoCancellation: "Supprime l'\u00e9cho et le retour audio. D\u00e9sactivez pour l'enregistrement musical ou en cas de probl\u00e8mes de qualit\u00e9.",
    tooltipAutoGainControl: "Ajuste automatiquement les niveaux de volume. D\u00e9sactivez pour la musique ou quand vous voulez un volume constant.",

    // About / info section
    about: '\u00c0 propos',
    aboutTitle: '\u00c0 propos de ParakeetWeb',
    privacyEmphasis: '100\u00a0% priv\u00e9 et local \u2014 votre audio ne quitte jamais votre appareil, ni serveur, ni cloud.',
    tagline: "Dict\u00e9e pour toute langue, sans rien installer\u00a0!",
    whatIsThis: "Qu'est-ce que c'est\u00a0?",
    infoDescription1: "ParakeetWeb est une application de reconnaissance vocale qui fonctionne enti\u00e8rement dans votre navigateur gr\u00e2ce \u00e0 WebAssembly et WebGPU. Votre audio ne quitte jamais votre appareil - tout le traitement se fait localement.",
    infoDescription2: "Elle utilise le mod\u00e8le Parakeet TDT de NVIDIA pour une transcription de haute qualit\u00e9 avec des horodatages et des scores de confiance au niveau des mots. Vous pouvez transcrire des fichiers audio ou enregistrer directement depuis votre microphone.",
    sourceCode: 'Code source',
    feedback: 'Retours',
    feedbackText: "Si vous avez une r\u00e9clamation ou un retour, vous pouvez nous contacter sur",
    orDirectlyBy: 'ou directement en',
    openingAnIssue: 'ouvrant un ticket',
    onTheGitHubRepo: 'sur le d\u00e9p\u00f4t GitHub.',
    install: 'Installation',
    installText: "Vous pouvez installer ParakeetWeb en tant que PWA (Progressive Web App) depuis votre navigateur pour un acc\u00e8s rapide.",
    privacy: 'Confidentialit\u00e9',
    privacyText: "Cette application utilise des statistiques respectueuses de la vie priv\u00e9e fournies par une instance auto-h\u00e9berg\u00e9e de",
    privacyText2: "Aucune donn\u00e9e personnelle n'est collect\u00e9e et aucun cookie de suivi n'est utilis\u00e9.",

    // Keyboard shortcuts
    keyboardShortcuts: 'Raccourcis clavier',
    shortcutToggleSettings: 'Ouvrir/fermer les param\u00e8tres',
    shortcutStopRecording: "Arr\u00eater l'enregistrement (pendant l'enregistrement)",
    shortcutStartRecording: "D\u00e9marrer l'enregistrement",
    shortcutSelectFile: 'S\u00e9lectionner un fichier audio',
    shortcutTranscribe: 'Lancer la transcription',
    shortcutLoadModel: 'Charger le mod\u00e8le',
    shortcutsDisabledInInputs: 'Les raccourcis sont d\u00e9sactiv\u00e9s dans les champs de saisie.',

    // Transcriptions
    transcriptions: 'Transcriptions',
    copied: '\u2713 Copi\u00e9',
    copyText: '\ud83d\udccb Copier le texte',
    copyDictation: '\u2728 Copier la dict\u00e9e',
    delete: '\ud83d\uddd1\ufe0f Supprimer',

    // Warnings
    devModeBanner: "\u26a0\ufe0f Version de d\u00e9veloppement \u2014 cette instance est en cours de d\u00e9veloppement actif. Attendez-vous \u00e0 des bugs, de l'instabilit\u00e9 et des changements fr\u00e9quents.",
    lowRamWarning: '\u26a0\ufe0f Votre appareil pourrait avoir une m\u00e9moire limit\u00e9e',
    lowRamModelMayFail: '. Le mod\u00e8le de reconnaissance vocale (~100\u2013200 Mo) pourrait ne pas se charger.',
    sharedArrayBufferWarning: "\u26a0\ufe0f Note de performance\u00a0: SharedArrayBuffer n'est pas disponible. WASM fonctionnera en mono-thread. Pour de meilleures performances, servez via HTTPS avec les bons en-t\u00eates ou utilisez WebGPU.",

    // Fallback prompt
    couldNotReachHF: 'Impossible de joindre HuggingFace pour t\u00e9l\u00e9charger les poids du mod\u00e8le.',
    localCopyAvailable: "Cette instance poss\u00e8de une copie locale des poids \u2014 souhaitez-vous l'utiliser\u00a0?",
    localFallbackNotEnabled: "Le fallback local n'est pas activ\u00e9 sur cette instance.",

    // System info
    system: '\ud83d\udcbe Syst\u00e8me',
    ram: 'RAM',
    heap: 'Tas',
    high: '\u26a0\ufe0f \u00c9lev\u00e9',
    cpu: 'CPU',
    fps: 'IPS',
    lowFps: '\u26a0\ufe0f IPS bas',
    storage: 'Stockage',

    // Performance
    rtf: 'RTF',
    total: 'Total',
    preprocess: 'Pr\u00e9traitement',
    encode: 'Encodage',
    decode: 'D\u00e9codage',
    tokenize: 'Tokenisation',

    // Misc
    help: 'Aide',
    moreActions: 'Plus d\'actions',
    toggleInfo: 'Basculer les infos',
    hideInfo: 'Masquer les infos',
    showInfo: 'Afficher les infos',
    toggleSettings: 'Basculer les param\u00e8tres',
    hideSettings: 'Masquer les param\u00e8tres',
    showSettings: 'Afficher les param\u00e8tres',
    closeSettings: 'Fermer les param\u00e8tres',

    // Reset confirm
    resetConfirmTitle: '\u26a0\ufe0f Cela supprimera d\u00e9finitivement TOUS les param\u00e8tres et l\'historique des transcriptions.',
    resetConfirmQuestion: '\u00cates-vous s\u00fbr de vouloir continuer\u00a0?',
    resetFailed: 'La r\u00e9initialisation a \u00e9chou\u00e9. Veuillez v\u00e9rifier la console pour plus de d\u00e9tails.',
    loadModelFirst: "Chargez d'abord le mod\u00e8le",
    failedCopyClipboard: '\u00c9chec de la copie dans le presse-papiers',

    // Dictation device
    dictationDevice: 'Appareil de dict\u00e9e',
    dictationDeviceHint: 'RECORD = d\u00e9marrer/pause/reprendre \u00b7 STOP = arr\u00eater',

    // Transcribing status
    transcribingFile: 'Transcription de',
    processingResampling: 'Traitement - R\u00e9\u00e9chantillonnage audio...',
    resamplingTo16k: '\u23f3 R\u00e9\u00e9chantillonnage \u00e0 16kHz...',
    complete: 'termin\u00e9',
    chunk: 'segment',

    // Language
    language: 'Langue',

    // Mobile remote-mic page
    mobileTitle: 'ParakeetWeb Micro Distant',
    mobileInitializing: 'Initialisation...',
    mobileConnecting: 'Connexion au PC en cours...',
    mobileEstablishingEncryption: 'Chiffrement en cours...',
    mobileRecording: 'Enregistrement',
    mobilePaused: 'Pause',
    mobilePauseBtn: '\u23f8 Pause',
    mobileResumeBtn: '\u25b6 Reprendre',
    mobileStopBtn: '\u23f9 Stop & Envoyer',
    mobileDisconnectBtn: 'D\u00e9connecter',
    mobileStartNewBtn: '\u25cf Nouvel enregistrement',
    mobileRecordingSent: 'Enregistrement envoy\u00e9 au PC.',
    mobileStartAnother: 'Lancez un autre enregistrement ou d\u00e9connectez-vous.',
    mobileSessionEnded: 'Connexion termin\u00e9e.',
    mobileSessionEndedHint: 'Pour vous reconnecter, cliquez sur \u00ab\u00a0R\u00e9g\u00e9n\u00e9rer le QR Code\u00a0\u00bb sur votre PC, puis scannez le nouveau QR code avec l\u2019appareil photo de votre t\u00e9l\u00e9phone.',
    mobileNoAudio: 'Aucun son d\u00e9tect\u00e9',
    mobileSpeakLouder: 'Parlez plus fort',
    mobileGoodLevel: 'Niveau audio correct',
    mobileDebugLogs: 'Logs de d\u00e9bogage',
    mobileOpenMenu: '\u2261',
    mobileCloseMenu: '\u00d7 Fermer',
    mobileLanguageHeading: 'Langue',
    mobileAboutHeading: '\u00c0 propos',
    mobileAboutBlurb: 'ParakeetWeb est un outil de reconnaissance vocale local et open-source qui fonctionne enti\u00e8rement dans votre navigateur. Aucune donn\u00e9e audio ne quitte votre appareil. Construit avec Claude Code.',
    mobileOpenSource: 'Voir sur GitHub (open source)',
    mobileInvalidLink: 'Lien invalide. Veuillez scanner le QR code \u00e0 nouveau.',
    mobileInvalidLinkMissing: 'Lien invalide. ID de salle ou secret manquant.',
    mobileMicDenied: 'Acc\u00e8s au microphone refus\u00e9. Veuillez autoriser l\u2019acc\u00e8s et r\u00e9essayer.',
    mobileMicFailed: '\u00c9chec de capture du microphone\u00a0: ',
    mobileRescanHint: 'Scannez le nouveau QR code affich\u00e9 sur votre PC avec l\u2019appareil photo de votre t\u00e9l\u00e9phone pour d\u00e9marrer une nouvelle session.',
    mobileConnectedReady: 'Connect\u00e9. Appuyez sur D\u00e9marrer l\u2019enregistrement.',
    mobileConfirmDisconnectTitle: 'D\u00e9connecter\u00a0?',
    mobileConfirmDisconnectBody: 'Cela terminera la session. Vous devrez scanner un nouveau QR code pour vous reconnecter.',
    mobileConfirmDisconnectYes: 'Oui, d\u00e9connecter',
    mobileConfirmDisconnectNo: 'Annuler',
  },
};

/**
 * Detect the preferred language from the browser.
 * Returns 'fr' if French is detected, otherwise 'en'.
 */
function detectLanguage() {
  const langs = navigator.languages || [navigator.language || 'fr'];
  for (const lang of langs) {
    const code = lang.toLowerCase().split('-')[0];
    if (code === 'fr') return 'fr';
    if (code === 'en') return 'en';
  }
  // If unsure (not French, not English), default to French
  return 'fr';
}

const I18nContext = createContext();

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    // Check localStorage for saved preference
    const saved = localStorage.getItem('parakeetweb_lang');
    if (saved && translations[saved]) return saved;
    return detectLanguage();
  });

  useEffect(() => {
    localStorage.setItem('parakeetweb_lang', lang);
  }, [lang]);

  const t = (key) => {
    return translations[lang]?.[key] || translations.en[key] || key;
  };

  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <select
      value={lang}
      onChange={e => setLang(e.target.value)}
      style={{
        padding: '0.2rem 0.4rem',
        borderRadius: '4px',
        border: '1px solid #d1d5db',
        fontSize: '0.85rem',
        background: 'white',
        cursor: 'pointer',
      }}
      aria-label="Language"
    >
      <option value="fr">FR</option>
      <option value="en">EN</option>
    </select>
  );
}
