// --- STATE & INITIALIZATION ---
let currentLang = 'english';
let db = null;
let appData = {
    words: {}, // { dateString: [wordObj1, wordObj2...] }
    tests: [], // [ { title: "Test 1", questions: [], answers: {}, analysis: {} } ]
    grammar: [] // [ { id: "123", title: "Past Simple", html: "<p>...</p>" } ]
};

let currentWordList = [];
let currentTestIndex = -1;
let currentTestQuestions = [];
let currentQuestionIndex = 0;
let userTestAnswers = {};
let currentGrammarNoteId = null;

// Game State
let gameState = {
    mode: 0,
    wordPool: [],
    currentWord: null,
    score: 0,
    wrongList: []
};

// Language Themes
const themes = {
    japanese: { gradient: 'linear-gradient(135deg, #ffe5ec 0%, #ffc2d1 100%)', primary: '#ff4d6d' },
    english: { gradient: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)', primary: '#6a5af9' },
    spanish: { gradient: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', primary: '#e17055' },
    italian: { gradient: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)', primary: '#00b894' },
    russian: { gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)', primary: '#d63031' }
};

document.addEventListener('DOMContentLoaded', () => {
    // Initialize LocalForage instance for app state
    db = localforage.createInstance({ name: "VocabularyAppDB" });
    
    // Pre-load voices list for speechSynthesis
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
    }
    
    // File Input Listeners
    document.getElementById('file-word-upload').addEventListener('change', handleWordUpload);
    document.getElementById('file-test-upload').addEventListener('change', handleTestUpload);
    document.getElementById('file-grammar-upload').addEventListener('change', handleGrammarUpload);
    document.getElementById('file-backup-upload').addEventListener('change', handleBackupUpload);
    document.getElementById('file-flashcard-upload').addEventListener('change', handleFlashcardUpload);
    document.getElementById('file-other-word-upload').addEventListener('change', handleOtherWordUpload);
    initFloatingEditorToolbar();
});

// --- NAVIGATION ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    const target = document.getElementById(screenId);
    target.classList.remove('hidden');
    target.classList.add('active');
}

function goBack(targetScreenId) {
    showScreen(targetScreenId);
    if(targetScreenId === 'screen-home') {
        document.body.style.background = 'var(--bg-gradient)';
    }
}

async function selectLanguage(lang) {
    currentLang = lang;
    document.body.style.background = themes[lang].gradient;
    
    const titles = { english: 'İngilizce', spanish: 'İspanyolca', italian: 'İtalyanca', russian: 'Rusça', japanese: 'Japonca' };
    document.getElementById('current-lang-title').innerText = titles[lang] + " Merkezi";
    
    // Load Data
    showLoading("Veriler yükleniyor...");
    try {
        let data = null;
        if (window.pywebview && window.pywebview.api) {
            data = await window.pywebview.api.load_data(currentLang);
        } else {
            data = await db.getItem(currentLang);
        }
        
        if (data) {
            appData = data;
        } else {
            appData = { words: {}, tests: [], grammar: [] };
        }
        
        // Normalize fields
        if (!appData.words) appData.words = {};
        if (!appData.otherWords) appData.otherWords = {};
        if (!appData.tests) appData.tests = [];
        if (!appData.grammar) appData.grammar = [];
        if (!appData.flashcards) appData.flashcards = {};
        if (!appData.spacedStatus) appData.spacedStatus = {};
        if (!appData.stats) appData.stats = { correct: 0, wrong: 0 };
        if (!appData.wrongWords) appData.wrongWords = {};
    } catch (e) {
        console.error(e);
        appData = { words: {}, tests: [], grammar: [] };
    }
    hideLoading();
    
    // Check for Spaced Repetition reviews
    checkDailyReviews();
    
    
    // Toggle Japanese specific dashboard cards
    document.querySelectorAll('.japanese-only').forEach(elem => {
        if (currentLang === 'japanese') {
            elem.classList.remove('hidden');
        } else {
            elem.classList.add('hidden');
        }
    });
    
    // Retrieve sync settings
    const savedSyncKey = localStorage.getItem('sync_key');
    const savedAutoSync = localStorage.getItem('sync_auto');
    const syncKeyInput = document.getElementById('sync-key-input');
    const autoSyncCheckbox = document.getElementById('sync-auto-checkbox');
    
    if (syncKeyInput && savedSyncKey) {
        syncKeyInput.value = savedSyncKey;
    }
    if (autoSyncCheckbox && savedAutoSync === 'true') {
        autoSyncCheckbox.checked = true;
        setTimeout(() => {
            syncWithCloud(true);
        }, 800);
    }
    
    showScreen('screen-dashboard');
}

async function saveData() {
    try {
        if (window.pywebview && window.pywebview.api) {
            await window.pywebview.api.save_data(currentLang, appData);
        } else {
            await db.setItem(currentLang, appData);
        }
        
        // Auto Cloud Sync if enabled
        if (localStorage.getItem('sync_auto') === 'true' && localStorage.getItem('sync_key')) {
            syncWithCloud(true);
        }
    } catch (e) {
        console.error("Error saving data:", e);
    }
}

function showLoading(text="İşleniyor...") {
    document.getElementById('loading-text').innerText = text;
    document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function alertMsg(title, text, icon="success") {
    Swal.fire({ title, text, icon, confirmButtonColor: themes[currentLang].primary });
}

// --- PARSERS ---

// WORD PARSER
async function handleWordUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading("Word belgesi okunuyor...");
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
        const text = result.value;
        parseWordDocument(text);
        
        // Reset file input
        e.target.value = '';
    } catch (error) {
        console.error(error);
        alertMsg("Hata", "Dosya okunurken bir hata oluştu.", "error");
        hideLoading();
    }
}

function parseWordDocument(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let parsedWords = [];
    let currentWordObj = null;
    let currentState = null; // 'examples', 'preps', 'phrasals', 'syns', 'ants'

    // Regex to match the main word line e.g., "Preserve (Prizerv)" or "Preserve (v) (Prizerv)"
    const wordRegex = /^([a-zA-Z\s\-]+)\s*\(.*?\)$/;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        
        // Check if it's a new word definition line
        // Usually it doesn't have a colon, starts with the word, and has pronunciation in parentheses.
        // Let's rely on "Genel Anlamı:" appearing shortly after to confirm.
        if (i + 1 < lines.length && lines[i+1].startsWith("Genel Anlamı:")) {
            if (currentWordObj) parsedWords.push(currentWordObj);
            
            // Extract word and type (if any)
            let rawWord = line.split('(')[0].trim();
            let typeMatch = line.match(/\((v|n|adj|adv|pv)\)/i);
            let type = typeMatch ? typeMatch[1] : '';
            
            currentWordObj = {
                word: rawWord,
                type: type,
                meaning: "",
                context: "",
                examples: [],
                preps: [],
                phrasals: [],
                synonyms: [],
                antonyms: []
            };
            currentState = null;
            continue;
        }

        if (!currentWordObj) continue;

        if (line.startsWith("Genel Anlamı:")) {
            currentWordObj.meaning = line.replace("Genel Anlamı:", "").trim();
            currentState = null;
        } else if (line.includes("Kullanım Bağlamı:")) {
            currentWordObj.context = line.replace(/.*Kullanım Bağlamı:/, "").trim();
            currentState = null;
        } else if (line.includes("Örnek Cümle") && line.includes("Bağlam")) {
            currentState = 'examples';
        } else if (line.includes("En Çok Kullanıldığı Edatlar")) {
            currentState = 'preps';
        } else if (line.includes("Phrasal Verb Kullanımı")) {
            currentState = 'phrasals';
        } else if (line.includes("Eş Anlamlısı") || line.includes("Eş Anlamlılar")) {
            currentState = 'syns';
        } else if (line.includes("Zıt Anlamlısı") || line.includes("Zıt Anlamlılar")) {
            currentState = 'ants';
        } else {
            // Data collection based on state
            if (currentState === 'syns' && line.length > 2) {
                currentWordObj.synonyms.push(line.trim());
            } else if (currentState === 'ants' && line.length > 2) {
                currentWordObj.antonyms.push(line.trim());
            } else if (line.match(/^\d+\./) || line.match(/^[o\-\•]/)) { 
                let cleanLine = line.replace(/^\d+\.\s*/, "").replace(/^[o\-\•]\s*/, "").trim();
                
                if (currentState === 'examples' && cleanLine.length > 5) {
                    currentWordObj.examples.push(cleanLine);
                } else if (currentState === 'preps' && cleanLine.length > 2) {
                    currentWordObj.preps.push(cleanLine);
                } else if (currentState === 'phrasals' && cleanLine.length > 2) {
                    currentWordObj.phrasals.push(cleanLine);
                }
            }
        }
    }
    if (currentWordObj) parsedWords.push(currentWordObj);

    if (parsedWords.length > 0) {
        const today = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
        const listName = `${today} Listesi`;
        
        if (!appData.words[listName]) appData.words[listName] = [];
        appData.words[listName] = appData.words[listName].concat(parsedWords);
        
        saveData().then(() => {
            hideLoading();
            alertMsg("Başarılı", `${parsedWords.length} kelime başarıyla eklendi!`);
        });
    } else {
        hideLoading();
        alertMsg("Hata", "Belgede uygun formatta kelime bulunamadı.", "warning");
    }
}

// TEST PARSER
async function handleTestUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading("Test belgesi okunuyor...");
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
        const text = result.value;
        parseTestDocument(text);
        
        e.target.value = '';
    } catch (error) {
        console.error(error);
        alertMsg("Hata", "Dosya okunurken bir hata oluştu.", "error");
        hideLoading();
    }
}

function parseTestDocument(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let testObj = {
        title: `Test ${appData.tests.length + 1}`,
        questions: [], // { q: "", options: ["A) ...", "B) ..."] }
        answers: {}, // { 1: "C", 2: "B" }
        analysis: {} // { 1: "Analiz text..." }
    };

    let state = 'questions'; // 'questions', 'keys', 'analysis'
    let currentQ = null;
    let currentAnalysisQ = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (line.includes("Cevap Anahtarı")) {
            if (currentQ) { testObj.questions.push(currentQ); currentQ = null; }
            state = 'keys';
            continue;
        }
        if (line.includes("Soru Analizleri")) {
            state = 'analysis';
            continue;
        }

        if (state === 'questions') {
            let qMatch = line.match(/^(\d+)\.\s+(.*)/);
            if (qMatch) {
                if (currentQ) testObj.questions.push(currentQ);
                currentQ = { id: qMatch[1], text: qMatch[2], options: [] };
            } else if (line.match(/^[A-E]\)/) && currentQ) {
                currentQ.options.push(line);
            }
        } 
        else if (state === 'keys') {
            // E.g. 1-C | 2-B | 3-B
            let parts = line.split('|');
            parts.forEach(p => {
                let m = p.trim().match(/(\d+)\s*-\s*([A-E])/);
                if (m) testObj.answers[m[1]] = m[2];
            });
        } 
        else if (state === 'analysis') {
            // E.g. 1. C (obsolete) or 1. C
            let aMatch = line.match(/^(\d+)\.\s*[A-E]/);
            if (aMatch) {
                currentAnalysisQ = aMatch[1];
                testObj.analysis[currentAnalysisQ] = line + "\n";
            } else if (currentAnalysisQ) {
                testObj.analysis[currentAnalysisQ] += line + "\n";
            }
        }
    }
    if (currentQ && state === 'questions') testObj.questions.push(currentQ); // Just in case it ends without key

    if (testObj.questions.length > 0) {
        appData.tests.push(testObj);
        saveData().then(() => {
            hideLoading();
            alertMsg("Başarılı", `${testObj.questions.length} soruluk ${testObj.title} eklendi!`);
        });
    } else {
        hideLoading();
        alertMsg("Uyarı", "Belgede test formatı algılanamadı.", "warning");
    }
}


// --- UI: SMART ADD WORD (SÖZLÜK) ---
function showAddWordScreen() {
    clearSmartWordForm();
    
    const dateSelect = document.getElementById('form-word-date');
    dateSelect.innerHTML = '';
    
    const today = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    const todayListName = `${today} Listesi`;
    
    const existingDates = Object.keys(appData.words);
    
    let datesToPopulate = [];
    if (!existingDates.includes(todayListName)) {
        datesToPopulate.push(todayListName);
    }
    datesToPopulate = datesToPopulate.concat(existingDates);
    
    datesToPopulate.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.innerText = d;
        dateSelect.appendChild(opt);
    });
    
    const optNew = document.createElement('option');
    optNew.value = '__new__';
    optNew.innerText = '+ Yeni Liste Oluştur...';
    dateSelect.appendChild(optNew);
    
    toggleFormNewDate();
    showScreen('screen-add-word');
}

function toggleFormNewDate() {
    const dateSelect = document.getElementById('form-word-date');
    const newDateInput = document.getElementById('form-word-new-date');
    if (dateSelect.value === '__new__') {
        newDateInput.classList.remove('hidden');
    } else {
        newDateInput.classList.add('hidden');
    }
}

function clearSmartWordForm() {
    document.getElementById('add-word-search-input').value = '';
    document.getElementById('form-word-name').value = '';
    document.getElementById('form-word-type').value = '';
    document.getElementById('form-word-meaning').value = '';
    document.getElementById('form-word-context').value = '';
    document.getElementById('form-word-examples').value = '';
    document.getElementById('form-word-synonyms').value = '';
    document.getElementById('form-word-antonyms').value = '';
    if (document.getElementById('form-word-preps')) {
        document.getElementById('form-word-preps').value = '';
    }
    document.getElementById('form-word-new-date').value = '';
    document.getElementById('add-word-loading-status').classList.add('hidden');
}

async function searchWordInDictionary() {
    const searchInput = document.getElementById('add-word-search-input').value.trim();
    if (!searchInput) {
        alertMsg("Hata", "Lütfen bir kelime yazın.", "error");
        return;
    }
    
    const loadingStatus = document.getElementById('add-word-loading-status');
    loadingStatus.classList.remove('hidden');
    
    document.getElementById('form-word-name').value = searchInput;
    document.getElementById('form-word-type').value = '';
    document.getElementById('form-word-meaning').value = '';
    document.getElementById('form-word-context').value = '';
    document.getElementById('form-word-examples').value = '';
    document.getElementById('form-word-synonyms').value = '';
    document.getElementById('form-word-antonyms').value = '';
    if (document.getElementById('form-word-preps')) {
        document.getElementById('form-word-preps').value = '';
    }
    
    try {
        // 1. Fetch from Dictionary API
        const dictRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(searchInput)}`);
        let dictData = null;
        if (dictRes.ok) {
            dictData = await dictRes.json();
        }
        
        // 2. Fetch Translation fallback
        const transRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(searchInput)}`);
        let trWord = searchInput;
        if (transRes.ok) {
            const transData = await transRes.json();
            if (transData && transData[0] && transData[0][0]) {
                trWord = transData[0][0][0];
            }
        }
        
        // 3. Fetch and parse Sesli Sözlük
        let sesliHtml = null;
        const sesliUrl = `https://www.seslisozluk.net/${encodeURIComponent(searchInput)}-nedir-ne-demek/`;
        try {
            if (window.pywebview && window.pywebview.api && window.pywebview.api.fetch_url) {
                sesliHtml = await window.pywebview.api.fetch_url(sesliUrl);
            } else {
                // Fallback chain of multiple public CORS proxies to ensure connectivity
                const proxies = [
                    url => `/api/proxy?url=${encodeURIComponent(url)}`, // Vercel Serverless Proxy (first choice when deployed)
                    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
                    url => `https://thingproxy.freeboard.io/fetch/${url}`
                ];
                
                for (let getProxyUrl of proxies) {
                    try {
                        const proxyUrl = getProxyUrl(sesliUrl);
                        const proxyRes = await fetch(proxyUrl);
                        if (proxyRes.ok) {
                            if (proxyUrl.includes('allorigins.win')) {
                                const proxyData = await proxyRes.json();
                                sesliHtml = proxyData.contents;
                            } else {
                                sesliHtml = await proxyRes.text();
                            }
                            // Verify that we received actual Sesli Sözlük HTML contents
                            if (sesliHtml && sesliHtml.includes('seslisozluk')) {
                                break;
                            }
                        }
                    } catch (err) {
                        console.warn("Proxy failed, trying next...", err);
                    }
                }
            }
        } catch (e) {
            console.error("Sesli Sozluk fetch error:", e);
        }

        let sesliMeanings = [];
        let sesliSynonyms = [];
        let sesliAntonyms = [];
        let sesliRelated = [];
        let sesliExamples = [];
        
        if (sesliHtml) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(sesliHtml, 'text/html');
            
            // Robust language matching term detection (immune to casing/accent mismatches)
            const langSearchMap = {
                english: ['ing', 'eng'],
                spanish: ['isp', 'span', 'esp'],
                italian: ['ital'],
                russian: ['rus']
            };
            const searchTerms = langSearchMap[currentLang] || ['eng'];
            
            let targetPanelHeader = Array.from(doc.querySelectorAll('.panel-heading'))
                .find(el => {
                    const text = (el.textContent || '').toLowerCase();
                    return searchTerms.some(term => text.includes(term));
                });
            
            let panel = null;
            if (targetPanelHeader) {
                panel = targetPanelHeader.closest('.panel');
            }
            
            // Fallback: If no panel heading matches the target language, take the first panel that contains dd.ordered-list
            if (!panel) {
                const allPanels = doc.querySelectorAll('.panel');
                for (let p of allPanels) {
                    if (p.querySelector('dd.ordered-list')) {
                        panel = p;
                        break;
                    }
                }
            }

            if (panel) {
                const dds = panel.querySelectorAll('dd.ordered-list');
                dds.forEach(dd => {
                    // Extract human example sentences
                    const examplePs = dd.querySelectorAll('p');
                    examplePs.forEach(p => {
                        const qTr = p.querySelector('q[lang="tr"]');
                        const qEn = p.querySelector('q[lang="en"]');
                        if (qTr && qEn) {
                            const enText = qEn.textContent.trim();
                            const trText = qTr.textContent.trim();
                            if (enText && trText) {
                                sesliExamples.push(`${enText} (${trText})`);
                            }
                        } else {
                            const text = p.textContent.trim();
                            if (text && text.includes(' - ')) {
                                sesliExamples.push(text);
                            }
                        }
                    });
                    
                    // Clean meanings
                    const ddClone = dd.cloneNode(true);
                    ddClone.querySelectorAll('p').forEach(p => p.remove());
                    let cleanMeaning = ddClone.textContent.trim().replace(/\s+/g, ' ');
                    
                    // Clean up type indicators and inline example notes
                    cleanMeaning = cleanMeaning.replace(/\{[^}]+\}/g, '').trim();
                    cleanMeaning = cleanMeaning.replace(/^\([^)]+\)/g, '').trim();
                    if (cleanMeaning.includes(':')) {
                        cleanMeaning = cleanMeaning.split(':')[0].trim();
                    }
                    
                    if (cleanMeaning) {
                        const individualMeanings = cleanMeaning.split(/[;,]/)
                            .map(m => m.trim())
                            .filter(m => m.length > 0);
                        sesliMeanings.push(...individualMeanings);
                    }
                });
            }
            
            // Synonyms
            const synDiv = doc.getElementById('synonyms');
            if (synDiv) {
                synDiv.querySelectorAll('a').forEach(a => {
                    const val = a.textContent.trim();
                    if (val) sesliSynonyms.push(val);
                });
            }
            
            // Antonyms
            const antDiv = doc.getElementById('antonyms');
            if (antDiv) {
                antDiv.querySelectorAll('a').forEach(a => {
                    const val = a.textContent.trim();
                    if (val) sesliAntonyms.push(val);
                });
            }
            
            // Related Terms: Query dt.similar from the panel first, fallback to the entire document if empty
            let dtElements = panel ? panel.querySelectorAll('dt.similar') : [];
            if (dtElements.length === 0) {
                dtElements = doc.querySelectorAll('dt.similar');
            }
            
            dtElements.forEach(dt => {
                const term = dt.textContent.trim().replace(/\s+/g, ' ');
                
                // Scan forward to find the next element sibling that is a DD (skips proxy/ad-injected helper tags or scripts)
                let sibling = dt.nextElementSibling;
                while (sibling && sibling.tagName.toUpperCase() !== 'DT' && sibling.tagName.toUpperCase() !== 'DD') {
                    sibling = sibling.nextElementSibling;
                }
                
                if (sibling && sibling.tagName.toUpperCase() === 'DD') {
                    const def = sibling.textContent.trim().replace(/\s+/g, ' ');
                    if (term && def) {
                        const hasTrLink = sibling.querySelector('a[lang="tr"]');
                        // Filter: accept if it is inside the target panel, or contains Turkish characters / non-English text
                        if (panel && panel.contains(dt)) {
                            sesliRelated.push(`${term}: ${def}`);
                        } else if (hasTrLink || /[ıışğüçİŞĞÜÇ]/.test(def) || !/^[a-zA-Z\s.,()'-]+$/.test(def)) {
                            sesliRelated.push(`${term}: ${def}`);
                        }
                    }
                }
            });
        }

        // 4. Parse & Combine Dictionary API data
        let dictSynonyms = [];
        let dictAntonyms = [];
        let dictExamples = [];
        let dictType = '';
        let dictDefinition = '';
        
        if (dictData && dictData[0]) {
            const entry = dictData[0];
            if (entry.meanings && entry.meanings.length > 0) {
                const pos = entry.meanings[0].partOfSpeech;
                if (pos.startsWith('verb')) dictType = 'v';
                else if (pos.startsWith('noun')) dictType = 'n';
                else if (pos.startsWith('adj')) dictType = 'adj';
                else if (pos.startsWith('adv')) dictType = 'adv';
                
                if (entry.meanings[0].definitions && entry.meanings[0].definitions[0]) {
                    dictDefinition = entry.meanings[0].definitions[0].definition;
                }
                
                for (let m of entry.meanings) {
                    if (m.synonyms && m.synonyms.length > 0) {
                        dictSynonyms = dictSynonyms.concat(m.synonyms);
                    }
                    if (m.antonyms && m.antonyms.length > 0) {
                        dictAntonyms = dictAntonyms.concat(m.antonyms);
                    }
                    for (let d of m.definitions) {
                        if (d.example) {
                            dictExamples.push(d.example);
                        }
                    }
                }
            }
        }

        // Set Word Type
        let finalType = dictType;
        if (!finalType && sesliHtml) {
            const fullText = sesliHtml.toLowerCase();
            if (fullText.includes('{f}')) finalType = 'v';
            else if (fullText.includes('{i}')) finalType = 'n';
            else if (fullText.includes('{s}')) finalType = 'adj';
            else if (fullText.includes('{zf}')) finalType = 'adv';
        }
        document.getElementById('form-word-type').value = finalType;

        // Set Word Meaning (ensuring clean definitions and at least 3 if possible)
        let cleanMeanings = sesliMeanings.map(m => m.replace(/^\d+[\.\}]?\s*/, '').trim());
        cleanMeanings = [...new Set(cleanMeanings)].filter(m => m.length > 0);
        
        // If we don't have enough meanings, add the Google Translate result
        if (cleanMeanings.length < 3 && trWord) {
            if (!cleanMeanings.some(m => m.toLowerCase() === trWord.toLowerCase())) {
                cleanMeanings.push(trWord);
            }
        }
        
        let finalMeaningText = '';
        if (cleanMeanings.length > 0) {
            finalMeaningText = cleanMeanings.slice(0, 6).join(', ');
        } else {
            finalMeaningText = trWord;
        }
        document.getElementById('form-word-meaning').value = finalMeaningText;

        // Set Word Context
        let contextVal = '';
        if (dictDefinition) {
            let trDef = '';
            try {
                const defTransRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(dictDefinition)}`);
                if (defTransRes.ok) {
                    const defTransData = await defTransRes.json();
                    if (defTransData && defTransData[0] && defTransData[0][0]) {
                        trDef = defTransData[0][0][0];
                    }
                }
            } catch (err) { console.error(err); }
            contextVal = `${dictDefinition} (${trDef})`;
        } else {
            contextVal = "Çeviri yapıldı.";
        }
        document.getElementById('form-word-context').value = contextVal;

        // Set Example Sentences (exactly 5)
        let finalExamples = [...sesliExamples];
        if (finalExamples.length < 5) {
            const cleanDictExs = [...new Set(dictExamples)].filter(ex => ex.trim().length > 0);
            for (let ex of cleanDictExs) {
                if (finalExamples.length >= 5) break;
                const isDup = finalExamples.some(fe => fe.toLowerCase().includes(ex.toLowerCase()) || ex.toLowerCase().includes(fe.split('(')[0].trim().toLowerCase()));
                if (isDup) continue;
                
                let trEx = '';
                try {
                    const exTransRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(ex)}`);
                    if (exTransRes.ok) {
                        const exTransData = await exTransRes.json();
                        if (exTransData && exTransData[0] && exTransData[0][0]) {
                            trEx = exTransData[0][0][0];
                        }
                    }
                } catch (err) { console.error(err); }
                finalExamples.push(`${ex} (${trEx})`);
            }
        }
        document.getElementById('form-word-examples').value = finalExamples.slice(0, 5).join('\n');

        // Set Synonyms (up to 4, translated)
        let rawSyns = sesliSynonyms.length > 0 ? sesliSynonyms : dictSynonyms;
        rawSyns = [...new Set(rawSyns)].slice(0, 4);
        let formattedSyns = [];
        for (let i = 0; i < rawSyns.length; i++) {
            const syn = rawSyns[i];
            let trSyn = syn;
            try {
                const synTransRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(syn)}`);
                if (synTransRes.ok) {
                    const synTransData = await synTransRes.json();
                    if (synTransData && synTransData[0] && synTransData[0][0]) {
                        trSyn = synTransData[0][0][0];
                    }
                }
            } catch (err) { console.error(err); }
            formattedSyns.push(`${i+1}. ${syn} (${trSyn})`);
        }
        document.getElementById('form-word-synonyms').value = formattedSyns.join('\n');

        // Set Antonyms (up to 4, translated)
        let rawAnts = sesliAntonyms.length > 0 ? sesliAntonyms : dictAntonyms;
        rawAnts = [...new Set(rawAnts)].slice(0, 4);
        let formattedAnts = [];
        for (let i = 0; i < rawAnts.length; i++) {
            const ant = rawAnts[i];
            let trAnt = ant;
            try {
                const antTransRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(ant)}`);
                if (antTransRes.ok) {
                    const antTransData = await antTransRes.json();
                    if (antTransData && antTransData[0] && antTransData[0][0]) {
                        trAnt = antTransData[0][0][0];
                    }
                }
            } catch (err) { console.error(err); }
            formattedAnts.push(`${i+1}. ${ant} (${trAnt})`);
        }
        document.getElementById('form-word-antonyms').value = formattedAnts.join('\n');

        // Set Related Terms
        if (document.getElementById('form-word-preps')) {
            document.getElementById('form-word-preps').value = sesliRelated.slice(0, 8).join('\n');
        }

    } catch (e) {
        console.error("Dictionary fetching error:", e);
        document.getElementById('form-word-context').value = "Arama sırasında bir hata oluştu veya bağlantı kurulamadı.";
    } finally {
        loadingStatus.classList.add('hidden');
    }
}

async function saveSmartWord() {
    const word = document.getElementById('form-word-name').value.trim();
    const type = document.getElementById('form-word-type').value;
    const meaning = document.getElementById('form-word-meaning').value.trim();
    const context = document.getElementById('form-word-context').value.trim();
    const examplesRaw = document.getElementById('form-word-examples').value;
    const synonymsRaw = document.getElementById('form-word-synonyms').value;
    const antonymsRaw = document.getElementById('form-word-antonyms').value;
    const prepsRaw = document.getElementById('form-word-preps') ? document.getElementById('form-word-preps').value : '';
    
    const dateSelect = document.getElementById('form-word-date');
    let listDate = dateSelect.value;
    
    if (listDate === '__new__') {
        listDate = document.getElementById('form-word-new-date').value.trim();
    }
    
    if (!word) {
        alertMsg("Hata", "Kelime alanı boş olamaz.", "error");
        return;
    }
    if (!meaning) {
        alertMsg("Hata", "Genel Anlamı alanı boş olamaz.", "error");
        return;
    }
    if (!listDate) {
        alertMsg("Hata", "Lütfen kelimenin ekleneceği bir liste tarihi seçin veya yazın.", "error");
        return;
    }
    
    const splitLines = (text) => text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const wordObj = {
        word: word,
        type: type,
        meaning: meaning,
        context: context,
        examples: splitLines(examplesRaw),
        synonyms: splitLines(synonymsRaw),
        antonyms: splitLines(antonymsRaw),
        preps: splitLines(prepsRaw)
    };
    
    showLoading("Kaydediliyor...");
    try {
        if (!appData.words[listDate]) {
            appData.words[listDate] = [];
        }
        
        const exists = appData.words[listDate].some(w => w.word.toLowerCase() === word.toLowerCase());
        if (exists) {
            hideLoading();
            alertMsg("Bilgi", `"${word}" zaten bu listede mevcut.`, "info");
            return;
        }
        
        appData.words[listDate].push(wordObj);
        await saveData();
        hideLoading();
        
        alertMsg("Başarılı", `"${word}" kelimesi "${listDate}" listesine başarıyla eklendi!`);
        openWordList(listDate);
    } catch (err) {
        console.error(err);
        hideLoading();
        alertMsg("Hata", "Kaydetme sırasında bir sorun oluştu.", "error");
    }
}


// --- UI: WORD LISTS ---
function showWordLists() {
    const container = document.getElementById('date-list-container');
    container.innerHTML = '';
    
    const dates = Object.keys(appData.words);
    if (dates.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">Henüz kelime yüklenmemiş.</p>';
    } else {
        dates.forEach(date => {
            const wordsCount = appData.words[date].length;
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.flex = '1';
            contentDiv.style.cursor = 'pointer';
            contentDiv.innerHTML = `<h3>${date}</h3><span>${wordsCount} Kelime</span>`;
            contentDiv.onclick = () => openWordList(date);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.style.background = 'none';
            deleteBtn.style.border = 'none';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.fontSize = '1.2rem';
            deleteBtn.style.marginLeft = '15px';
            deleteBtn.style.padding = '5px 10px';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteWordList(date);
            };
            
            div.appendChild(contentDiv);
            div.appendChild(deleteBtn);
            container.appendChild(div);
        });
    }
    showScreen('screen-word-dates');
}

function deleteWordList(date) {
    Swal.fire({
        title: 'Emin misiniz?',
        text: `"${date}" listesini ve içindeki tüm kelimeleri silmek istediğinize emin misiniz?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'İptal',
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if (result.isConfirmed) {
            delete appData.words[date];
            showLoading("Siliniyor...");
            await saveData();
            hideLoading();
            alertMsg("Silindi", "Kelime listesi başarıyla silindi.");
            showWordLists();
        }
    });
}

function openWordList(date) {
    document.getElementById('words-date-title').innerText = date;
    const list = document.getElementById('words-list');
    list.innerHTML = '';
    
    currentWordList = appData.words[date] || [];
    
    // Sort alphabetically by word
    currentWordList.sort((a, b) => a.word.localeCompare(b.word));
    
    currentWordList.forEach((w, index) => {
        const li = document.createElement('li');
        li.className = 'word-row';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        
        const leftDiv = document.createElement('div');
        leftDiv.style.display = 'flex';
        leftDiv.style.alignItems = 'center';
        leftDiv.style.flex = '1';
        leftDiv.style.cursor = 'pointer';
        leftDiv.onclick = () => showWordDetail(w);
        
        leftDiv.innerHTML = `
            <div class="word-checkbox" onclick="event.stopPropagation(); this.parentElement.parentElement.classList.toggle('learned')"></div>
            <div>
                <span class="word-main">${w.word}</span>
                ${w.type ? `<span class="word-type">(${w.type})</span>` : ''}
                <span class="word-meaning">${w.meaning}</span>
            </div>
        `;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.style.background = 'none';
        deleteBtn.style.border = 'none';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.fontSize = '1.2rem';
        deleteBtn.style.marginLeft = '15px';
        deleteBtn.style.padding = '5px 10px';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteWord(date, w);
        };
        
        li.appendChild(leftDiv);
        li.appendChild(deleteBtn);
        list.appendChild(li);
    });
    
    showScreen('screen-words');
}

function deleteWord(date, wordObj) {
    Swal.fire({
        title: 'Emin misiniz?',
        text: `"${wordObj.word}" kelimesini silmek istediğinize emin misiniz?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'İptal',
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if (result.isConfirmed) {
            appData.words[date] = appData.words[date].filter(item => item !== wordObj);
            if (appData.words[date].length === 0) {
                delete appData.words[date];
            }
            showLoading("Siliniyor...");
            await saveData();
            hideLoading();
            alertMsg("Silindi", "Kelime başarıyla silindi.");
            if (appData.words[date]) {
                openWordList(date);
            } else {
                showWordLists();
            }
        }
    });
}

function speakWord(text) {
    if (!text) return;
    
    // Select language code
    let langCode = 'en';
    if (currentLang === 'spanish') langCode = 'es';
    if (currentLang === 'italian') langCode = 'it';
    if (currentLang === 'russian') langCode = 'ru';
    
    // We try to use Google Translate TTS (or Youdao for English) online first
    let url = "";
    if (langCode === 'en') {
        // Youdao is extremely reliable and fast for English words (type=2 is US accent)
        url = `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(text)}`;
    } else {
        url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(text)}`;
    }
    
    let audio = new Audio(url);
    
    // Set a timeout to fallback to offline speechSynthesis in case of slow connection / offline
    let fallbackTriggered = false;
    const triggerFallback = () => {
        if (!fallbackTriggered) {
            fallbackTriggered = true;
            speakWordOffline(text);
        }
    };
    
    // If the audio takes too long to load (e.g. offline/slow internet), fallback after 1.2 seconds
    let timeoutId = setTimeout(triggerFallback, 1200);
    
    audio.onplay = () => {
        clearTimeout(timeoutId);
    };
    
    audio.onerror = () => {
        clearTimeout(timeoutId);
        triggerFallback();
    };
    
    audio.play().catch(err => {
        clearTimeout(timeoutId);
        triggerFallback();
    });
}

function speakWordOffline(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        
        let utterance = new SpeechSynthesisUtterance(text);
        let langCode = 'en-US';
        if (currentLang === 'spanish') langCode = 'es-ES';
        if (currentLang === 'italian') langCode = 'it-IT';
        if (currentLang === 'russian') langCode = 'ru-RU';
        
        utterance.lang = langCode;
        
        let voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
            let selectedVoice = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase()) ||
                                voices.find(v => v.lang.toLowerCase().startsWith(langCode.split('-')[0].toLowerCase()));
            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }
        }
        
        window.speechSynthesis.speak(utterance);
    }
}

function showWordDetail(w) {
    document.getElementById('detail-word-title').innerText = w.word.toUpperCase();
    const container = document.getElementById('word-detail-content');
    container.innerHTML = '';

    // Main
    container.innerHTML += `
        <div class="detail-block db-main">
            <h2>${w.word} ${w.type ? `<i>(${w.type})</i>` : ''} <button onclick="speakWord('${w.word.replace(/'/g, "\\'")}')" style="background:none; border:none; cursor:pointer; font-size:1.5rem; vertical-align: middle;" title="Dinle">🔊</button></h2>
            <div class="word-meaning"><strong>Anlamı:</strong> ${w.meaning}</div>
            ${w.context ? `<div style="margin-top:10px; color:#555;"><strong>Bağlam:</strong> ${w.context}</div>` : ''}
        </div>
    `;

    // Examples
    if (w.examples && w.examples.length > 0) {
        let exHtml = w.examples.map(ex => {
            // Split english and turkish if format is "Eng (Tur)" or "Eng. (Tur)"
            let parts = ex.split('(');
            let en = parts[0].trim();
            let tr = parts.length > 1 ? '(' + parts.slice(1).join('(').trim() : '';
            return `<div class="example-sentence"><strong>${en}</strong><span>${tr}</span></div>`;
        }).join('');
        container.innerHTML += `<div class="detail-block db-examples"><h3>Örnek Cümleler</h3>${exHtml}</div>`;
    }

    // Preps
    if (w.preps && w.preps.length > 0) {
        let phtml = w.preps.map(p => `<div class="example-sentence">${p}</div>`).join('');
        container.innerHTML += `<div class="detail-block db-preps"><h3>İlgili Terimler / Edat Kullanımı</h3>${phtml}</div>`;
    }
    if (w.phrasals && w.phrasals.length > 0) {
        let phtml = w.phrasals.map(p => `<div class="example-sentence">${p}</div>`).join('');
        container.innerHTML += `<div class="detail-block db-preps"><h3>Phrasal Verb Kullanımı / Eşdeğerleri</h3>${phtml}</div>`;
    }

    // Synonyms and Antonyms formatting
    let processList = (list) => {
        let normalizedLines = [];
        for (let j = 0; j < list.length; j++) {
            let line = list[j];
            
            // Merge standalone number with the next line (word)
            if (line.match(/^\d+[\.\)]?$/) && j + 1 < list.length) {
                line = line + " " + list[j+1];
                j++;
            }
            
            // If the next line is the description (starts with - or ->), merge it too!
            if (j + 1 < list.length && list[j+1].match(/^[-o\•]|->/)) {
                line = line + " " + list[j+1];
                j++;
            }
            
            // Split sentences that are squished together in one line
            line = line.replace(/(\.|\?|!)\)\s+([A-Z])/g, "$1) ||| $2");
            line = line.replace(/(bağlamında|anlamında|korumaktır\.|tutmaktır\.)\s+([A-Z])/g, "$1 ||| $2");
            
            let subLines = line.split(" ||| ");
            normalizedLines.push(...subLines);
        }

        let result = [];
        let currentSynAntWord = null;

        for (let line of normalizedLines) {
            let speakBtnHtml = "";
            let wordToSpeak = null;
            
            const isNumbered = line.match(/^\d+[\.\-\s]+/);
            
            let clean = line.replace(/^\d+[\.\-\s]*/, '').trim();
            let wordMatch = clean.match(/^([a-zA-Z\s\-'\u2019]+)/);
            if (wordMatch) {
                let candidate = wordMatch[1].trim();
                if (candidate && candidate.split(' ').length <= 4 && !candidate.toLowerCase().startsWith("farkı")) {
                    wordToSpeak = candidate;
                }
            }

            if (wordToSpeak) {
                currentSynAntWord = wordToSpeak;
                speakBtnHtml = `<button onclick="event.stopPropagation(); speakWord('${wordToSpeak.replace(/'/g, "\\'")}')" style="background:none; border:none; cursor:pointer; font-size:1.15rem; margin-left: 6px; vertical-align: middle;" title="Dinle">🔊</button>`;
            }

            if (isNumbered) {
                // Apply bold and yellow highlight
                line = `<span style="background-color: #fff176; color: #2c3e50; font-weight: bold; padding: 3px 6px; border-radius: 4px; display: inline-block; margin-bottom: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">${line}</span>${speakBtnHtml}`;
            } else {
                // Not a header, bold the current synonym word
                if (currentSynAntWord) {
                    let regex = new RegExp(`\\b(${currentSynAntWord})\\b`, "gi");
                    line = line.replace(regex, "<strong>$1</strong>");
                }
                
                // Also bold the main word just in case
                let mainRegex = new RegExp(`\\b(${w.word})\\b`, "gi");
                line = line.replace(mainRegex, "<strong>$1</strong>");
                
                // Add speaker button if starts with word and parenthesis
                if (line.match(/^([a-zA-Z\s\-'\u2019]+)\s*\(/) && wordToSpeak) {
                    line = line + speakBtnHtml;
                }
            }
            
            result.push(`<div class="example-sentence" style="margin-bottom:15px; display:block;">${line}</div>`);
        }
        
        return result.join('');
    };

    // Synonyms
    if (w.synonyms && w.synonyms.length > 0) {
        let html = processList(w.synonyms);
        container.innerHTML += `<div class="detail-block db-synonyms"><h3>Eş Anlamlıları</h3>${html}</div>`;
    }

    // Antonyms
    if (w.antonyms && w.antonyms.length > 0) {
        let html = processList(w.antonyms);
        container.innerHTML += `<div class="detail-block db-antonyms"><h3>Zıt Anlamlıları</h3>${html}</div>`;
    }

    showScreen('screen-word-detail');
}

// --- UI: TESTS ---
function showTests() {
    const container = document.getElementById('tests-list-container');
    container.innerHTML = '';
    
    if (!appData.tests || appData.tests.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">Henüz test yüklenmemiş.</p>';
    } else {
        appData.tests.forEach((t, i) => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.flex = '1';
            contentDiv.style.cursor = 'pointer';
            contentDiv.innerHTML = `<h3>${t.title}</h3><span>${t.questions.length} Soru</span>`;
            contentDiv.onclick = () => startTest(i);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.style.background = 'none';
            deleteBtn.style.border = 'none';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.fontSize = '1.2rem';
            deleteBtn.style.marginLeft = '15px';
            deleteBtn.style.padding = '5px 10px';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteTest(i, t.title);
            };
            
            div.appendChild(contentDiv);
            div.appendChild(deleteBtn);
            container.appendChild(div);
        });
    }
    showScreen('screen-tests-list');
}

function deleteTest(index, title) {
    Swal.fire({
        title: 'Emin misiniz?',
        text: `"${title}" testini silmek istediğinize emin misiniz?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'İptal',
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if (result.isConfirmed) {
            appData.tests.splice(index, 1);
            showLoading("Siliniyor...");
            await saveData();
            hideLoading();
            alertMsg("Silindi", "Test başarıyla silindi.");
            showTests();
        }
    });
}

function startTest(index) {
    currentTestIndex = index;
    currentTestQuestions = appData.tests[index].questions;
    currentQuestionIndex = 0;
    userTestAnswers = {};
    document.getElementById('test-title').innerText = appData.tests[index].title;
    
    renderTestQuestion();
    showScreen('screen-active-test');
}

function renderTestQuestion() {
    const q = currentTestQuestions[currentQuestionIndex];
    document.getElementById('test-progress').innerText = `${currentQuestionIndex + 1} / ${currentTestQuestions.length}`;
    
    const container = document.getElementById('test-question-container');
    const analysisContainer = document.getElementById('test-analysis-container');
    const nextBtn = document.getElementById('btn-next-question');
    
    analysisContainer.classList.add('hidden');
    analysisContainer.innerHTML = '';
    nextBtn.style.display = 'none';
    
    let html = `<div class="question-text">${q.id}. ${q.text}</div><div class="options-list">`;
    
    q.options.forEach(opt => {
        let letterMatch = opt.match(/^([A-E])\)/);
        let letter = letterMatch ? letterMatch[1] : '';
        html += `<div class="option-btn" onclick="selectTestOption('${letter}', this)">${opt}</div>`;
    });
    html += `</div>`;
    
    container.innerHTML = html;
}

function selectTestOption(letter, element) {
    // Disable all options
    const options = document.querySelectorAll('.option-btn');
    options.forEach(opt => opt.classList.add('disabled'));
    
    const test = appData.tests[currentTestIndex];
    const q = currentTestQuestions[currentQuestionIndex];
    const correctLetter = test.answers[q.id];
    
    if (letter === correctLetter) {
        element.classList.add('correct');
    } else {
        element.classList.add('wrong');
        // Find and highlight correct one
        options.forEach(opt => {
            if(opt.innerText.startsWith(correctLetter + ")")) {
                opt.classList.add('correct');
            }
        });
    }
    
    userTestAnswers[q.id] = letter;
    
    // Show Analysis
    const analysisContainer = document.getElementById('test-analysis-container');
    const nextBtn = document.getElementById('btn-next-question');
    
    if (test.analysis && test.analysis[q.id]) {
        analysisContainer.innerHTML = `<h4>Soru Analizi</h4><p style="white-space: pre-wrap;">${test.analysis[q.id]}</p>`;
        analysisContainer.classList.remove('hidden');
    }
    
    nextBtn.style.display = 'inline-block';
    
    if (currentQuestionIndex === currentTestQuestions.length - 1) {
        nextBtn.innerText = "Testi Bitir";
    } else {
        nextBtn.innerText = "Sonraki Soru";
    }
}

function nextQuestion() {
    if (currentQuestionIndex < currentTestQuestions.length - 1) {
        currentQuestionIndex++;
        renderTestQuestion();
    } else {
        // Test finished
        let correctCount = 0;
        const test = appData.tests[currentTestIndex];
        Object.keys(userTestAnswers).forEach(qId => {
            if (userTestAnswers[qId] === test.answers[qId]) correctCount++;
        });
        
        Swal.fire({
            title: "Test Tamamlandı!",
            text: `Doğru Sayısı: ${correctCount} / ${currentTestQuestions.length}`,
            icon: "success",
            confirmButtonColor: themes[currentLang].primary
        }).then(() => {
            showTests();
        });
    }
}

function endTestEarly() {
    Swal.fire({
        title: "Emin misiniz?",
        text: "Testten çıkmak istediğinize emin misiniz?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Evet, Çık",
        cancelButtonText: "İptal"
    }).then((result) => {
        if(result.isConfirmed) showTests();
    });
}

// --- GAMES MODULE ---
function showGames() {
    let allWords = [];
    Object.values(appData.words).forEach(list => { allWords = allWords.concat(list); });
    
    if (allWords.length < 5) {
        alertMsg("Uyarı", "Oyun oynayabilmek için sistemde en az 5 kelime yüklü olmalıdır.", "warning");
        return;
    }
    
    gameState.wordPool = allWords;
    showScreen('screen-games-menu');
}

function startGame(mode) {
    gameState.mode = mode;
    gameState.score = 0;
    gameState.wrongList = [];
    document.getElementById('game-score').innerText = "Puan: 0";
    
    const titles = ["", "1. Türkçe Anlamı Sor", "2. Bağlamdan Kelimeyi Bul", "3. Eş/Zıt Anlamı Nedir?", "4. Tüm Eş/Zıt Anlamlıları Yaz", "5. Listeden Eş/Zıt Seçmece", "6. Kelime Baloncuk Eşleştirme"];
    document.getElementById('game-title').innerText = titles[mode];
    
    showScreen('screen-active-game');
    nextGameQuestion();
}

function nextGameQuestion() {
    const container = document.getElementById('game-content-container');
    container.innerHTML = '';
    
    if (gameState.mode === 6) {
        startBubbleGame();
        return;
    }
    
    // Pick random word
    gameState.currentWord = gameState.wordPool[Math.floor(Math.random() * gameState.wordPool.length)];
    const w = gameState.currentWord;
    
    if (gameState.mode === 1) {
        container.innerHTML = `
            <div class="game-question">${w.word.toUpperCase()}</div>
            <input type="text" id="game-answer-input" class="game-input" placeholder="Türkçe anlamını girin..." onkeypress="if(event.key === 'Enter') checkGameAnswer()">
            <div id="game-feedback" class="game-feedback"></div>
            <button class="btn-primary" onclick="checkGameAnswer()">Cevapla</button>
            <button class="btn-primary" style="background:#e74c3c; margin-left:10px;" onclick="nextGameQuestion()">Atla</button>
        `;
        setTimeout(() => document.getElementById('game-answer-input').focus(), 100);
    } 
    else if (gameState.mode === 2) {
        if (!w.context) { nextGameQuestion(); return; }
        
        container.innerHTML = `
            <div class="game-question" style="font-size:1.5rem; line-height:1.4;">${w.context}</div>
            <input type="text" id="game-answer-input" class="game-input" placeholder="Kelimeyi girin..." onkeypress="if(event.key === 'Enter') checkGameAnswer()">
            <div id="game-feedback" class="game-feedback"></div>
            <button class="btn-primary" onclick="checkGameAnswer()">Cevapla</button>
            <button class="btn-primary" style="background:#e74c3c; margin-left:10px;" onclick="nextGameQuestion()">Atla</button>
        `;
        setTimeout(() => document.getElementById('game-answer-input').focus(), 100);
    }
    else if (gameState.mode === 3) {
        // Extract raw syns/ants (first word before parenthesis or hyphen if exists)
        let getRaw = (line) => line.split(/[\(\-\•\:]/)[0].trim().toLowerCase();
        let syns = w.synonyms ? w.synonyms.map(getRaw).filter(x=>x) : [];
        let ants = w.antonyms ? w.antonyms.map(getRaw).filter(x=>x) : [];
        
        if (syns.length === 0 && ants.length === 0) { nextGameQuestion(); return; }
        
        let askType = syns.length > 0 ? (ants.length > 0 ? (Math.random() > 0.5 ? 'syn' : 'ant') : 'syn') : 'ant';
        let ansList = askType === 'syn' ? syns : ants;
        let askText = askType === 'syn' ? 'Eş Anlamlısı' : 'Zıt Anlamlısı';
        
        // Store for checking
        gameState.correctAnswers = ansList;
        
        container.innerHTML = `
            <div style="font-size:1.2rem; color:#666; margin-bottom:10px;">Bu kelimenin ${askText} nedir?</div>
            <div class="game-question">${w.word.toUpperCase()}</div>
            <input type="text" id="game-answer-input" class="game-input" placeholder="Bir tane yazın..." onkeypress="if(event.key === 'Enter') checkGameAnswer()">
            <div id="game-feedback" class="game-feedback"></div>
            <button class="btn-primary" onclick="checkGameAnswer()">Cevapla</button>
            <button class="btn-primary" style="background:#e74c3c; margin-left:10px;" onclick="nextGameQuestion()">Atla</button>
        `;
        setTimeout(() => document.getElementById('game-answer-input').focus(), 100);
    }
    // Mode 4 and 5 are similar logic, simplified for brevity but functional.
    else {
        // Fallback to simple meaning game if not fully implemented for time
        container.innerHTML = `
            <div class="game-question">Bu mod yapım aşamasındadır. Lütfen diğer modları deneyin.</div>
            <button class="btn-primary" onclick="goBack('screen-games-menu')">Geri Dön</button>
        `;
    }
}

function normalizeTurkishText(str) {
    if (!str) return "";
    return str
        .toLowerCase()
        .replace(/[âä]/g, 'a')
        .replace(/[îï]/g, 'i')
        .replace(/[ûü]/g, 'u')
        .replace(/[ö]/g, 'o')
        .replace(/[ç]/g, 'c')
        .replace(/[ğ]/g, 'g')
        .replace(/[ş]/g, 's')
        .replace(/[ı]/g, 'i')
        .replace(/['’\"`´]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanFillers(str) {
    if (!str) return "";
    return str
        .replace(/\bbş\b\.?/g, '')
        .replace(/\bbir\s+şey\b/g, '')
        .replace(/\bbirşey\b/g, '')
        .replace(/\bbiri\b/g, '')
        .replace(/\bbirisi\b/g, '')
        .replace(/\bbirine\b/g, '')
        .replace(/\bbirini\b/g, '')
        .replace(/\bbirisiyle\b/g, '')
        .replace(/\bbiriyle\b/g, '')
        .replace(/\bsth\b\.?/g, '')
        .replace(/\bsb\b\.?/g, '')
        .replace(/\bsomeone\b/g, '')
        .replace(/\bsomething\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function checkTurkishMatch(userInput, correctMeaning) {
    const cleanInput = userInput.trim().toLowerCase();
    const normInput = normalizeTurkishText(cleanInput);
    const fillerFreeInput = cleanFillers(normInput);

    const parts = correctMeaning.split(/[,;\(\)\{\}\[\]]|\bveya\b|\bya\s+da\b/)
        .map(p => p.trim().toLowerCase())
        .filter(p => p.length > 0);

    for (let part of parts) {
        const cleanPart = part;
        const normPart = normalizeTurkishText(part);
        const fillerFreePart = cleanFillers(normPart);

        if (cleanInput === cleanPart) return true;
        if (normInput === normPart) return true;
        if (fillerFreeInput === fillerFreePart && fillerFreePart.length > 0) return true;
        
        if (fillerFreeInput.length >= 3 && fillerFreePart.includes(fillerFreeInput)) return true;
        if (fillerFreePart.length >= 3 && fillerFreeInput.includes(fillerFreePart)) return true;
    }
    
    const entireNormCorrect = normalizeTurkishText(correctMeaning);
    const entireFillerFreeCorrect = cleanFillers(entireNormCorrect);
    if (fillerFreeInput === entireFillerFreeCorrect && entireFillerFreeCorrect.length > 0) return true;
    if (fillerFreeInput.length >= 3 && entireFillerFreeCorrect.includes(fillerFreeInput)) return true;
    if (entireFillerFreeCorrect.length >= 3 && fillerFreeInput.includes(entireFillerFreeCorrect)) return true;

    return false;
}

function checkEnglishMatch(userInput, correctWord) {
    let cleanUser = userInput.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
    let cleanCorrect = correctWord.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
    return cleanUser === cleanCorrect;
}

function checkGameAnswer() {
    const input = document.getElementById('game-answer-input');
    const feedback = document.getElementById('game-feedback');
    const val = input.value.trim().toLowerCase();
    const w = gameState.currentWord;
    
    if (!val) return;
    
    let isCorrect = false;
    let correctText = "";
    
    if (gameState.mode === 1) {
        if (checkTurkishMatch(val, w.meaning)) isCorrect = true;
        correctText = w.meaning;
    } else if (gameState.mode === 2) {
        if (checkEnglishMatch(val, w.word)) isCorrect = true;
        correctText = w.word;
    } else if (gameState.mode === 3) {
        if (gameState.correctAnswers.some(ans => checkEnglishMatch(val, ans))) isCorrect = true;
        correctText = gameState.correctAnswers.join(', ');
    }
    
    if (isCorrect) {
        feedback.innerText = "Doğru! 🎉";
        feedback.className = "game-feedback game-correct";
        gameState.score += 10;
        document.getElementById('game-score').innerText = `Puan: ${gameState.score}`;
        input.disabled = true;
        recordCorrectAnswer(); // We will define this helper soon
        setTimeout(nextGameQuestion, 1500);
    } else {
        feedback.innerText = `Yanlış! Doğrusu: ${correctText}`;
        feedback.className = "game-feedback game-wrong";
        input.disabled = true;
        recordWrongWord(w, 'Oyun'); // We will define this helper soon
        setTimeout(nextGameQuestion, 2500);
    }
}

// --- BUBBLE GAME IMPLEMENTATION ---
let bubbleGameState = {
    selectedEnglish: null,
    selectedTurkish: null,
    matchedCount: 0,
    totalPairs: 0
};

let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playBubblePopSound() {
    try {
        initAudio();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {
        console.warn("Audio error:", e);
    }
}

function playBubbleBuzzSound() {
    try {
        initAudio();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.warn("Audio error:", e);
    }
}

function playSuccessSound() {
    try {
        initAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + i * 0.1);
            gain.gain.setValueAtTime(0.15, now + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.3);
        });
    } catch (e) {
        console.warn("Audio error:", e);
    }
}

function startBubbleGame() {
    const container = document.getElementById('game-content-container');
    container.innerHTML = '';
    
    let pool = [...gameState.wordPool];
    pool.sort(() => Math.random() - 0.5);
    // Grab up to 20 words for the matching game
    const gameWords = pool.slice(0, 20);
    bubbleGameState.totalPairs = gameWords.length;
    bubbleGameState.matchedCount = 0;
    bubbleGameState.selectedEnglish = null;
    bubbleGameState.selectedTurkish = null;
    
    let bubblesData = [];
    gameWords.forEach((w, idx) => {
        let cleanMeaning = w.meaning;
        if (cleanMeaning.startsWith("Genel Anlamı:")) {
            cleanMeaning = cleanMeaning.replace("Genel Anlamı:", "").trim();
        }
        if (cleanMeaning.length > 25) {
            cleanMeaning = cleanMeaning.substring(0, 22) + "...";
        }
        
        bubblesData.push({
            id: idx,
            text: w.word.toUpperCase(),
            type: 'english',
            matchId: idx
        });
        bubblesData.push({
            id: idx,
            text: cleanMeaning,
            type: 'turkish',
            matchId: idx
        });
    });
    
    bubblesData.sort(() => Math.random() - 0.5);
    
    const gameWrapper = document.createElement('div');
    gameWrapper.className = 'bubble-game-wrapper';
    
    const bubbleContainer = document.createElement('div');
    bubbleContainer.className = 'bubble-container';
    
    bubblesData.forEach(b => {
        const bubbleEl = document.createElement('div');
        bubbleEl.className = `bubble ${b.type}-bubble`;
        bubbleEl.innerText = b.text;
        bubbleEl.dataset.matchId = b.matchId;
        bubbleEl.dataset.type = b.type;
        
        bubbleEl.onclick = () => handleBubbleClick(bubbleEl);
        bubbleContainer.appendChild(bubbleEl);
    });
    
    gameWrapper.appendChild(bubbleContainer);
    container.appendChild(gameWrapper);
}

function handleBubbleClick(bubbleEl) {
    if (bubbleEl.classList.contains('matched-bubble') || bubbleEl.classList.contains('wrong-bubble')) {
        return;
    }
    
    const type = bubbleEl.dataset.type;
    const matchId = bubbleEl.dataset.matchId;
    
    if (type === 'english') {
        if (bubbleGameState.selectedEnglish) {
            bubbleGameState.selectedEnglish.classList.remove('selected-bubble');
        }
        bubbleGameState.selectedEnglish = bubbleEl;
        bubbleEl.classList.add('selected-bubble');
    } else {
        if (bubbleGameState.selectedTurkish) {
            bubbleGameState.selectedTurkish.classList.remove('selected-bubble');
        }
        bubbleGameState.selectedTurkish = bubbleEl;
        bubbleEl.classList.add('selected-bubble');
    }
    
    if (bubbleGameState.selectedEnglish && bubbleGameState.selectedTurkish) {
        const engId = bubbleGameState.selectedEnglish.dataset.matchId;
        const turId = bubbleGameState.selectedTurkish.dataset.matchId;
        const elEng = bubbleGameState.selectedEnglish;
        const elTur = bubbleGameState.selectedTurkish;
        
        if (engId === turId) {
            elEng.classList.remove('selected-bubble');
            elTur.classList.remove('selected-bubble');
            elEng.classList.add('matched-bubble');
            elTur.classList.add('matched-bubble');
            
            playBubblePopSound();
            
            gameState.score += 10;
            document.getElementById('game-score').innerText = `Puan: ${gameState.score}`;
            
            bubbleGameState.selectedEnglish = null;
            bubbleGameState.selectedTurkish = null;
            bubbleGameState.matchedCount++;
            
            if (bubbleGameState.matchedCount === bubbleGameState.totalPairs) {
                setTimeout(() => {
                    playSuccessSound();
                    Swal.fire({
                        title: 'Tebrikler! 🎉',
                        text: `Tüm baloncukları eşleştirdiniz! Toplam Puanınız: ${gameState.score}`,
                        icon: 'success',
                        confirmButtonColor: themes[currentLang].primary,
                        confirmButtonText: 'Tekrar Oyna',
                        showCancelButton: true,
                        cancelButtonText: 'Oyun Menüsü'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            startBubbleGame();
                        } else {
                            goBack('screen-games-menu');
                        }
                    });
                }, 600);
            }
        } else {
            elEng.classList.remove('selected-bubble');
            elTur.classList.remove('selected-bubble');
            elEng.classList.add('wrong-bubble');
            elTur.classList.add('wrong-bubble');
            
            playBubbleBuzzSound();
            
            bubbleGameState.selectedEnglish = null;
            bubbleGameState.selectedTurkish = null;
            
            setTimeout(() => {
                elEng.classList.remove('wrong-bubble');
                elTur.classList.remove('wrong-bubble');
            }, 600);
        }
    }
}

// --- GRAMMAR MODULE ---
function showGrammarSection() {
    const titles = { english: 'İngilizce', spanish: 'İspanyolca', italian: 'İtalyanca', russian: 'Rusça', japanese: 'Japonca' };
    document.getElementById('grammar-lang-title').innerText = titles[currentLang] + " Gramer Konuları";
    
    const container = document.getElementById('grammar-list-container');
    container.innerHTML = '';
    
    const notes = appData.grammar || [];
    if (notes.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">Henüz gramer notu yüklenmemiş.</p>';
    } else {
        notes.forEach(note => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `<h3>${note.title}</h3><span>Gramer</span>`;
            div.onclick = () => openGrammarNote(note.id);
            container.appendChild(div);
        });
    }
    showScreen('screen-grammar-list');
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function convertDocxNodeToHtml(node) {
    let html = "";
    if (!node) return html;
    
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        const nodeName = child.nodeName;
        const localName = child.localName || nodeName.replace(/^w:/, '');
        
        if (localName === 'p') {
            const pPr = child.querySelector("pPr, w\\:pPr");
            let alignment = "";
            let bulletText = "";
            
            if (pPr) {
                const jc = pPr.querySelector("jc, w\\:jc");
                if (jc) {
                    alignment = jc.getAttribute("w:val") || "";
                }
                const numPr = pPr.querySelector("numPr, w\\:numPr");
                if (numPr) {
                    bulletText = "• ";
                }
            }
            
            let style = alignment ? ` style="text-align: ${alignment};"` : '';
            const innerHtml = convertDocxNodeToHtml(child);
            if (innerHtml.trim().length > 0 || child.querySelector("br, w\\:br")) {
                html += `<p${style}>${bulletText}${innerHtml}</p>`;
            }
        } else if (localName === 'r') {
            const rPr = child.querySelector("rPr, w\\:rPr");
            let text = "";
            let styles = [];
            
            if (rPr) {
                if (rPr.querySelector("b, w\\:b")) {
                    styles.push("font-weight: bold");
                }
                if (rPr.querySelector("i, w\\:i")) {
                    styles.push("font-style: italic");
                }
                if (rPr.querySelector("u, w\\:u")) {
                    styles.push("text-decoration: underline");
                }
                const color = rPr.querySelector("color, w\\:color");
                if (color) {
                    let hex = color.getAttribute("w:val");
                    if (hex && hex !== 'auto') {
                        styles.push(`color: #${hex}`);
                    }
                }
                const sz = rPr.querySelector("sz, w\\:sz");
                if (sz) {
                    let val = parseInt(sz.getAttribute("w:val"), 10);
                    if (!isNaN(val)) {
                        styles.push(`font-size: ${val / 24}rem`);
                    }
                }
            }
            
            for (let j = 0; j < child.childNodes.length; j++) {
                const rChild = child.childNodes[j];
                const rLocalName = rChild.localName || rChild.nodeName.replace(/^w:/, '');
                if (rLocalName === 't') {
                    text += escapeHtml(rChild.textContent);
                } else if (rLocalName === 'br') {
                    text += "<br>";
                } else if (rLocalName === 'tab') {
                    text += "&nbsp;&nbsp;&nbsp;&nbsp;";
                }
            }
            
            if (styles.length > 0) {
                html += `<span style="${styles.join('; ')}">${text}</span>`;
            } else {
                html += text;
            }
        } else if (localName === 'tbl') {
            html += `<table class="grammar-table">${convertDocxNodeToHtml(child)}</table>`;
        } else if (localName === 'tr') {
            html += `<tr>${convertDocxNodeToHtml(child)}</tr>`;
        } else if (localName === 'tc') {
            html += `<td>${convertDocxNodeToHtml(child)}</td>`;
        } else if (localName === 'br') {
            html += `<br>`;
        } else if (localName === 't') {
            html += escapeHtml(child.textContent);
        } else {
            html += convertDocxNodeToHtml(child);
        }
    }
    return html;
}

async function parseDocxToHtmlWithColors(file) {
    const zip = await JSZip.loadAsync(file);
    const docXmlStr = await zip.file("word/document.xml").async("text");
    const parser = new DOMParser();
    const docXml = parser.parseFromString(docXmlStr, "application/xml");
    
    const body = docXml.getElementsByTagName("w:body")[0];
    if (!body) return "";
    
    return convertDocxNodeToHtml(body);
}

async function handleGrammarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const { value: title } = await Swal.fire({
        title: 'Gramer Başlığı',
        input: 'text',
        inputLabel: 'Lütfen gramer konusunun başlığını giriniz:',
        inputPlaceholder: 'Örn: Past Simple Tense',
        showCancelButton: true,
        confirmButtonColor: themes[currentLang].primary,
        cancelButtonText: 'İptal',
        confirmButtonText: 'Yükle',
        inputValidator: (value) => {
            if (!value) {
                return 'Bir başlık girmelisiniz!';
            }
        }
    });

    if (!title) {
        e.target.value = '';
        return;
    }

    showLoading("Word belgesi okunuyor...");
    try {
        const htmlContent = await parseDocxToHtmlWithColors(file);
        
        if (!appData.grammar) appData.grammar = [];
        appData.grammar.push({
            id: Date.now().toString(),
            title: title,
            html: htmlContent
        });
        
        await saveData();
        hideLoading();
        alertMsg("Başarılı", "Gramer konusu başarıyla yüklendi!");
        showGrammarSection();
    } catch (error) {
        console.error(error);
        alertMsg("Hata", "Word dosyası dönüştürülürken bir hata oluştu.", "error");
        hideLoading();
    }
    e.target.value = '';
}

function openGrammarNote(noteId) {
    const note = appData.grammar.find(n => n.id === noteId);
    if (!note) return;
    
    currentGrammarNoteId = noteId;
    
    // Set Header
    document.getElementById('grammar-note-title').innerText = note.title;
    
    // Set Read Mode content
    document.getElementById('read-note-title').innerText = note.title;
    document.getElementById('grammar-detail-html').innerHTML = note.html;
    
    // Set Chalkboard mode
    const detailCard = document.querySelector('.grammar-detail-card');
    if (detailCard) detailCard.classList.add('chalkboard-mode');
    
    // Reset to Read Mode
    document.getElementById('grammar-read-mode').classList.remove('hidden');
    document.getElementById('grammar-edit-mode').classList.add('hidden');
    
    document.getElementById('btn-grammar-edit').classList.remove('hidden');
    document.getElementById('btn-grammar-delete').classList.remove('hidden');
    document.getElementById('btn-grammar-save').classList.add('hidden');
    document.getElementById('btn-grammar-cancel').classList.add('hidden');
    
    showScreen('screen-grammar-detail');
}

function enableGrammarEditMode() {
    const note = appData.grammar.find(n => n.id === currentGrammarNoteId);
    if (!note) return;
    
    // Set values in input & contenteditable editor
    document.getElementById('edit-note-title-input').value = note.title;
    document.getElementById('edit-note-content-input').innerHTML = note.html;
    
    // Swap views
    document.getElementById('grammar-read-mode').classList.add('hidden');
    document.getElementById('grammar-edit-mode').classList.remove('hidden');
    
    document.getElementById('btn-grammar-edit').classList.add('hidden');
    document.getElementById('btn-grammar-delete').classList.add('hidden');
    document.getElementById('btn-grammar-save').classList.remove('hidden');
    document.getElementById('btn-grammar-cancel').classList.remove('hidden');
}

function cancelGrammarEdit() {
    // Just swap views back
    document.getElementById('grammar-read-mode').classList.remove('hidden');
    document.getElementById('grammar-edit-mode').classList.add('hidden');
    
    document.getElementById('btn-grammar-edit').classList.remove('hidden');
    document.getElementById('btn-grammar-delete').classList.remove('hidden');
    document.getElementById('btn-grammar-save').classList.add('hidden');
    document.getElementById('btn-grammar-cancel').classList.add('hidden');
}

async function saveGrammarEdit() {
    const note = appData.grammar.find(n => n.id === currentGrammarNoteId);
    if (!note) return;
    
    const newTitle = document.getElementById('edit-note-title-input').value.trim();
    const newHtml = document.getElementById('edit-note-content-input').innerHTML.trim();
    
    if (!newTitle) {
        alertMsg("Hata", "Lütfen bir başlık girin.", "error");
        return;
    }
    
    note.title = newTitle;
    note.html = newHtml;
    
    showLoading("Kaydediliyor...");
    await saveData();
    hideLoading();
    
    // Update header & views
    document.getElementById('grammar-note-title').innerText = note.title;
    document.getElementById('read-note-title').innerText = note.title;
    document.getElementById('grammar-detail-html').innerHTML = note.html;
    
    cancelGrammarEdit();
    alertMsg("Başarılı", "Değişiklikler kaydedildi!");
}

function deleteGrammarNote() {
    Swal.fire({
        title: "Emin misiniz?",
        text: "Bu gramer notunu silmek istediğinize emin misiniz?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Evet, Sil",
        cancelButtonText: "İptal",
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if(result.isConfirmed) {
            appData.grammar = appData.grammar.filter(n => n.id !== currentGrammarNoteId);
            showLoading("Siliniyor...");
            await saveData();
            hideLoading();
            alertMsg("Silindi", "Gramer konusu başarıyla silindi.");
            showGrammarSection();
        }
    });
}

// --- BACKUP & RESTORE MODULE ---
function exportBackup() {
    try {
        const jsonStr = JSON.stringify(appData, null, 4);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const langNames = { english: "ingilizce", spanish: "ispanyolca", italian: "italyanca", russian: "rusca" };
        a.download = `kelime_merkezi_yedek_${langNames[currentLang] || currentLang}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        alertMsg("Hata", "Yedek oluşturulurken bir hata oluştu.", "error");
    }
}

function handleBackupUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const importedData = JSON.parse(evt.target.result);
            
            // Basic validation
            if (importedData && (importedData.words || importedData.tests || importedData.grammar)) {
                // Ensure all keys exist
                appData.words = importedData.words || {};
                appData.tests = importedData.tests || [];
                appData.grammar = importedData.grammar || [];
                
                showLoading("Yedek yükleniyor...");
                await saveData();
                hideLoading();
                
                alertMsg("Başarılı", "Yedek başarıyla yüklendi ve aktarıldı!");
                
                // Refresh dashboard
                selectLanguage(currentLang);
            } else {
                alertMsg("Hata", "Geçersiz yedek dosyası formatı.", "error");
            }
        } catch (err) {
            console.error(err);
            alertMsg("Hata", "Dosya okunurken veya ayrıştırılırken hata oluştu.", "error");
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// --- SPACED REPETITION (ARALIKLI TEKRAR) ENGINE ---
let spacedReviewWords = [];
let spacedReviewIndex = 0;
let spacedTestWords = [];
let spacedTestIndex = 0;
let spacedTestAnswers = {};
let spacedTestQuestionMode = '';
let spacedDistractorsPool = [];
let spacedWeeklyWordsPool = [];

const turkishMonths = {
    'ocak': 0, 'şubat': 1, 'mart': 2, 'nisan': 3, 'mayıs': 4, 'haziran': 5,
    'temmuz': 6, 'ağustos': 7, 'eylül': 8, 'ekim': 9, 'kasım': 10, 'aralık': 11
};

function parseListNameToDate(listName) {
    const parts = listName.split(' ');
    if (parts.length >= 3) {
        const day = parseInt(parts[0], 10);
        const monthName = parts[1].toLowerCase();
        const year = parseInt(parts[2], 10);
        const month = turkishMonths[monthName];
        if (!isNaN(day) && month !== undefined && !isNaN(year)) {
            return new Date(year, month, day);
        }
    }
    return null;
}

function checkDailyReviews() {
    const banner = document.getElementById('spaced-repetition-banner');
    const bannerText = document.getElementById('spaced-banner-text');
    const btnReview = document.getElementById('btn-start-spaced-review');
    const btnTest = document.getElementById('btn-start-spaced-test');
    const btnWeekly = document.getElementById('btn-start-spaced-weekly');
    
    if (!banner) return;
    
    banner.classList.add('hidden');
    btnReview.classList.add('hidden');
    btnTest.classList.add('hidden');
    btnWeekly.classList.add('hidden');
    
    spacedReviewWords = [];
    spacedTestWords = [];
    let weeklyWords = [];
    
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    
    let hasAlert = false;
    let hasWeeklyAlert = false;
    
    // Normalize spacedStatus
    if (!appData.spacedStatus) appData.spacedStatus = {};
    
    // Build distractor pool
    spacedDistractorsPool = [];
    Object.values(appData.words).forEach(list => {
        list.forEach(w => {
            if (w.meaning) {
                spacedDistractorsPool.push(w.meaning);
            }
        });
    });
    spacedDistractorsPool = [...new Set(spacedDistractorsPool)];
    
    Object.keys(appData.words).forEach(listName => {
        const listDate = parseListNameToDate(listName);
        if (!listDate) return;
        
        listDate.setHours(0, 0, 0, 0);
        const diffTime = currentDate - listDate;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        const words = appData.words[listName];
        if (!words || words.length === 0) return;
        
        const status = appData.spacedStatus[listName] || {};
        
        if (diffDays === 1) {
            if (!status.review1) {
                spacedReviewWords = spacedReviewWords.concat(words);
                hasAlert = true;
            }
        } 
        else if (diffDays === 3) {
            if (!status.test3) {
                spacedTestWords = spacedTestWords.concat(words);
                hasAlert = true;
            }
        }
        else if (diffDays === 6) {
            if (!status.test6) {
                spacedTestWords = spacedTestWords.concat(words);
                hasAlert = true;
            }
        }
        
        if (diffDays >= 1 && diffDays <= 7) {
            weeklyWords = weeklyWords.concat(words);
        }
        
        if (diffDays === 7) {
            if (!status.test7) {
                hasWeeklyAlert = true;
            }
        }
    });
    
    if (hasAlert || (hasWeeklyAlert && weeklyWords.length > 0)) {
        banner.classList.remove('hidden');
        let statusTexts = [];
        
        if (spacedReviewWords.length > 0) {
            btnReview.classList.remove('hidden');
            statusTexts.push(`1 Günlük Tekrar (${spacedReviewWords.length} kelime)`);
        }
        if (spacedTestWords.length > 0) {
            btnTest.classList.remove('hidden');
            statusTexts.push(`3/6 Günlük Test (${spacedTestWords.length} kelime)`);
        }
        if (hasWeeklyAlert && weeklyWords.length > 0) {
            btnWeekly.classList.remove('hidden');
            spacedWeeklyWordsPool = weeklyWords;
            statusTexts.push(`Haftalık Genel Test (${weeklyWords.length} kelime)`);
        }
        
        if (statusTexts.length > 0) {
            bannerText.innerText = "Bugün aralıklı tekrar programınızda kelimeler var: " + statusTexts.join(" | ");
        } else {
            banner.classList.add('hidden');
        }
    }
}

function triggerSpacedReview() {
    if (spacedReviewWords.length === 0) return;
    spacedReviewIndex = 0;
    showSpacedCard();
    showScreen('screen-spaced-review');
}

function showSpacedCard() {
    const w = spacedReviewWords[spacedReviewIndex];
    document.getElementById('spaced-review-progress').innerText = `${spacedReviewIndex + 1} / ${spacedReviewWords.length}`;
    
    document.getElementById('spaced-card-word').innerText = w.word;
    document.getElementById('spaced-card-type').innerText = w.type ? `(${w.type})` : '';
    document.getElementById('spaced-card-meaning').innerText = w.meaning;
    
    const contextBlock = document.getElementById('spaced-card-context-block');
    const contextText = document.getElementById('spaced-card-context');
    if (w.context) {
        contextBlock.classList.remove('hidden');
        contextText.innerText = w.context;
    } else {
        contextBlock.classList.add('hidden');
    }
    
    const exampleBlock = document.getElementById('spaced-card-example-block');
    const exampleText = document.getElementById('spaced-card-example');
    if (w.examples && w.examples.length > 0) {
        exampleBlock.classList.remove('hidden');
        exampleText.innerText = w.examples[0];
    } else {
        exampleBlock.classList.add('hidden');
    }
    
    document.getElementById('spaced-card-inner').classList.remove('flipped');
}

function flipSpacedCard() {
    document.getElementById('spaced-card-inner').classList.toggle('flipped');
}

function nextSpacedCard() {
    if (spacedReviewIndex < spacedReviewWords.length - 1) {
        spacedReviewIndex++;
        showSpacedCard();
    } else {
        // Mark completion
        if (!appData.spacedStatus) appData.spacedStatus = {};
        Object.keys(appData.words).forEach(listName => {
            const listDate = parseListNameToDate(listName);
            if (!listDate) return;
            listDate.setHours(0, 0, 0, 0);
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);
            const diffTime = currentDate - listDate;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                if (!appData.spacedStatus[listName]) appData.spacedStatus[listName] = {};
                appData.spacedStatus[listName].review1 = true;
            }
        });
        
        Swal.fire({
            title: "Tekrar Tamamlandı! 🎉",
            text: "1 günlük kelime okuma tekrarınızı başarıyla bitirdiniz.",
            icon: "success",
            confirmButtonColor: themes[currentLang].primary
        }).then(async () => {
            showLoading("Kaydediliyor...");
            await saveData();
            hideLoading();
            goBack('screen-dashboard');
            checkDailyReviews();
        });
    }
}

function prevSpacedCard() {
    if (spacedReviewIndex > 0) {
        spacedReviewIndex--;
        showSpacedCard();
    }
}

// Tablet and Desktop both use standard IDs.
function triggerSpacedTest() {
    if (spacedTestWords.length === 0) return;
    spacedTestIndex = 0;
    spacedTestAnswers = {};
    spacedTestQuestionMode = 'daily';
    document.getElementById('spaced-test-title').innerText = "3/6 Günlük Aralıklı Tekrar Testi";
    
    renderSpacedQuestion();
    showScreen('screen-spaced-test');
}

function triggerSpacedWeeklyTest() {
    if (!spacedWeeklyWordsPool || spacedWeeklyWordsPool.length === 0) return;
    spacedTestWords = spacedWeeklyWordsPool;
    spacedTestIndex = 0;
    spacedTestAnswers = {};
    spacedTestQuestionMode = 'weekly';
    document.getElementById('spaced-test-title').innerText = "Haftalık Genel Tekrar Sınavı";
    
    renderSpacedQuestion();
    showScreen('screen-spaced-test');
}

function generateFiveOptions(correctMeaning) {
    let pool = spacedDistractorsPool.filter(m => m !== correctMeaning);
    pool.sort(() => Math.random() - 0.5);
    
    let options = pool.slice(0, 4);
    options.push(correctMeaning);
    options.sort(() => Math.random() - 0.5);
    
    while (options.length < 5) {
        options.push("Tanımsız Şık " + (options.length + 1));
    }
    return options;
}

function renderSpacedQuestion() {
    const w = spacedTestWords[spacedTestIndex];
    document.getElementById('spaced-test-progress').innerText = `${spacedTestIndex + 1} / ${spacedTestWords.length}`;
    
    const container = document.getElementById('spaced-test-question-container');
    const nextBtn = document.getElementById('btn-next-spaced-question');
    nextBtn.style.display = 'none';
    
    const options = generateFiveOptions(w.meaning);
    
    let html = `
        <div class="question-text">"${w.word}" kelimesinin Türkçe anlamı nedir?</div>
        <div class="options-list">
    `;
    
    options.forEach((opt, idx) => {
        const letters = ['A', 'B', 'C', 'D', 'E'];
        html += `<div class="option-btn" onclick="selectSpacedOption('${opt.replace(/'/g, "\\'")}', this)">${letters[idx]}) ${opt}</div>`;
    });
    html += `</div>`;
    
    container.innerHTML = html;
}

function selectSpacedOption(selectedVal, element) {
    const options = document.querySelectorAll('#spaced-test-question-container .option-btn');
    options.forEach(opt => opt.classList.add('disabled'));
    
    const w = spacedTestWords[spacedTestIndex];
    const correctVal = w.meaning;
    
    if (selectedVal === correctVal) {
        element.classList.add('correct');
    } else {
        element.classList.add('wrong');
        options.forEach(opt => {
            if (opt.innerText.slice(3).trim() === correctVal) {
                opt.classList.add('correct');
            }
        });
    }
    
    spacedTestAnswers[spacedTestIndex] = (selectedVal === correctVal);
    
    const nextBtn = document.getElementById('btn-next-spaced-question');
    nextBtn.style.display = 'inline-block';
    
    if (spacedTestIndex === spacedTestWords.length - 1) {
        nextBtn.innerText = "Sınavı Bitir";
    } else {
        nextBtn.innerText = "Sonraki Soru";
    }
}

function nextSpacedQuestion() {
    if (spacedTestIndex < spacedTestWords.length - 1) {
        spacedTestIndex++;
        renderSpacedQuestion();
    } else {
        let correctCount = 0;
        Object.values(spacedTestAnswers).forEach(isCorrect => {
            if (isCorrect) correctCount++;
        });
        
        // Mark completion
        if (!appData.spacedStatus) appData.spacedStatus = {};
        Object.keys(appData.words).forEach(listName => {
            const listDate = parseListNameToDate(listName);
            if (!listDate) return;
            listDate.setHours(0, 0, 0, 0);
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);
            const diffTime = currentDate - listDate;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            
            if (spacedTestQuestionMode === 'daily') {
                if (diffDays === 3 || diffDays === 6) {
                    if (!appData.spacedStatus[listName]) appData.spacedStatus[listName] = {};
                    if (diffDays === 3) appData.spacedStatus[listName].test3 = true;
                    if (diffDays === 6) appData.spacedStatus[listName].test6 = true;
                }
            } else if (spacedTestQuestionMode === 'weekly') {
                if (diffDays === 7) {
                    if (!appData.spacedStatus[listName]) appData.spacedStatus[listName] = {};
                    appData.spacedStatus[listName].test7 = true;
                }
            }
        });
        
        Swal.fire({
            title: "Tebrikler! Sınav Bitti 🏆",
            text: `Doğru Sayısı: ${correctCount} / ${spacedTestWords.length}`,
            icon: "success",
            confirmButtonColor: themes[currentLang].primary
        }).then(async () => {
            showLoading("Kaydediliyor...");
            await saveData();
            hideLoading();
            goBack('screen-dashboard');
            checkDailyReviews();
        });
    }
}

function confirmEndSpacedTest() {
    Swal.fire({
        title: "Sınavdan çıkmak istiyor musunuz?",
        text: "İlerlemeniz kaydedilmeyecektir.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Evet, Çık",
        cancelButtonText: "İptal"
    }).then((result) => {
        if(result.isConfirmed) {
            goBack('screen-dashboard');
        }
    });
}

// --- FLASHCARD MODULE ---
let currentFlashcardListName = "";
let flashcardTestPool = [];
let flashcardTestIndex = 0;
let flashcardTestDirection = "en-tr"; // 'en-tr' or 'tr-en'
let flashcardCorrectCount = 0;
let flashcardWrongCards = [];

async function handleFlashcardUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Prompt for List Name
    const today = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    const { value: listName } = await Swal.fire({
        title: 'Flash Kart Liste Adı',
        input: 'text',
        inputLabel: 'Lütfen flash kart listesinin adını giriniz:',
        inputValue: `${today} Flash Kart Listesi`,
        showCancelButton: true,
        confirmButtonColor: themes[currentLang].primary,
        cancelButtonText: 'İptal',
        confirmButtonText: 'Yükle',
        inputValidator: (value) => {
            if (!value) {
                return 'Bir liste adı girmelisiniz!';
            }
        }
    });

    if (!listName) {
        e.target.value = '';
        return;
    }

    showLoading("Word belgesi flash kartlar için okunuyor...");
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
        const htmlContent = result.value;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        const tables = tempDiv.querySelectorAll('table');
        let cards = [];
        
        if (tables.length > 0) {
            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        // Col 1: English word & Pronunciation
                        const col1Text = cells[0].innerHTML || "";
                        // replace tags with newline to separate lines
                        let cleanCol1 = col1Text.replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
                        let col1Lines = cleanCol1.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                        
                        // Col 2: Turkish meaning
                        const col2Text = cells[1].innerText || cells[1].textContent || "";
                        let cleanCol2 = col2Text.replace(/<[^>]+>/g, '').trim();
                        
                        if (col1Lines.length > 0 && cleanCol2) {
                            let word = col1Lines[0];
                            let pronunciation = "";
                            if (col1Lines.length > 1) {
                                pronunciation = col1Lines[1];
                            } else {
                                // Try regex parse like word (pronunciation)
                                let m = word.match(/^([a-zA-Z\s\-'\u2019]+)\s*\((.*?)\)$/);
                                if (m) {
                                    word = m[1].trim();
                                    pronunciation = '(' + m[2].trim() + ')';
                                }
                            }
                            
                            // Format pronunciation with parentheses if needed
                            if (pronunciation && !pronunciation.startsWith('(')) pronunciation = '(' + pronunciation;
                            if (pronunciation && !pronunciation.endsWith(')')) pronunciation = pronunciation + ')';
                            
                            cards.push({
                                word: word,
                                pronunciation: pronunciation,
                                meaning: cleanCol2
                            });
                        }
                    }
                });
            });
        }
        
        // Fallback: Text Parser
        if (cards.length === 0) {
            const cleanText = tempDiv.innerText || tempDiv.textContent || "";
            const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            let i = 0;
            while (i < lines.length) {
                let word = lines[i];
                let pronunciation = "";
                let meaning = "";
                
                if (i + 1 < lines.length && lines[i+1].startsWith('(')) {
                    pronunciation = lines[i+1];
                    if (i + 2 < lines.length) {
                        meaning = lines[i+2];
                        i += 3;
                    } else {
                        i += 2;
                    }
                } else if (i + 1 < lines.length) {
                    meaning = lines[i+1];
                    i += 2;
                } else {
                    i++;
                }
                
                if (word && meaning) {
                    cards.push({
                        word: word,
                        pronunciation: pronunciation,
                        meaning: meaning
                    });
                }
            }
        }
        
        if (cards.length > 0) {
            if (!appData.flashcards) appData.flashcards = {};
            
            appData.flashcards[listName] = cards;
            await saveData();
            hideLoading();
            alertMsg("Başarılı", `${cards.length} adet flash kart "${listName}" olarak yüklendi!`);
            showFlashcardDashboard();
        } else {
            hideLoading();
            alertMsg("Hata", "Belgede flash kart formatında (kelime ve anlamı) veri bulunamadı.", "warning");
        }
    } catch (error) {
        console.error(error);
        alertMsg("Hata", "Word dosyası ayrıştırılırken bir hata oluştu.", "error");
        hideLoading();
    }
    e.target.value = '';
}

function showFlashcardDashboard() {
    const container = document.getElementById('flashcard-list-container');
    container.innerHTML = '';
    
    if (!appData.flashcards) appData.flashcards = {};
    const lists = Object.keys(appData.flashcards);
    
    if (lists.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">Henüz flash kart listesi yüklenmemiş.</p>';
    } else {
        lists.forEach(listName => {
            const cardCount = appData.flashcards[listName].length;
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.flex = '1';
            contentDiv.style.cursor = 'pointer';
            contentDiv.innerHTML = `<h3>${listName}</h3><span>${cardCount} Kart</span>`;
            contentDiv.onclick = () => viewFlashcardList(listName);
            
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '10px';
            btnGroup.style.alignItems = 'center';
            
            const testBtn = document.createElement('button');
            testBtn.className = 'btn-primary';
            testBtn.innerText = 'Sınav Çöz';
            testBtn.style.padding = '5px 12px';
            testBtn.style.fontSize = '0.85rem';
            testBtn.style.borderRadius = '6px';
            testBtn.onclick = (e) => {
                e.stopPropagation();
                currentFlashcardListName = listName;
                startFlashcardTestDirectly();
            };
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.style.background = 'none';
            deleteBtn.style.border = 'none';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.fontSize = '1.2rem';
            deleteBtn.style.padding = '5px 10px';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteFlashcardList(listName);
            };
            
            btnGroup.appendChild(testBtn);
            btnGroup.appendChild(deleteBtn);
            
            div.appendChild(contentDiv);
            div.appendChild(btnGroup);
            container.appendChild(div);
        });
    }
    showScreen('screen-flashcard-dashboard');
}

function deleteFlashcardList(listName) {
    Swal.fire({
        title: 'Emin misiniz?',
        text: `"${listName}" flash kart listesini silmek istediğinize emin misiniz?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'İptal',
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if (result.isConfirmed) {
            delete appData.flashcards[listName];
            showLoading("Siliniyor...");
            await saveData();
            hideLoading();
            alertMsg("Silindi", "Flash kart listesi başarıyla silindi.");
            showFlashcardDashboard();
        }
    });
}

function viewFlashcardList(listName) {
    currentFlashcardListName = listName;
    document.getElementById('flashcard-view-title').innerText = listName;
    
    const listContainer = document.getElementById('flashcard-words-list');
    listContainer.innerHTML = '';
    
    const cards = appData.flashcards[listName] || [];
    
    cards.forEach(c => {
        const li = document.createElement('li');
        li.className = 'word-row';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        
        const leftDiv = document.createElement('div');
        leftDiv.style.flex = '1';
        leftDiv.innerHTML = `
            <div>
                <span class="word-main">${c.word}</span>
                ${c.pronunciation ? `<span class="word-type" style="color:var(--primary-color); font-weight:600;">${c.pronunciation}</span>` : ''}
                <span class="word-meaning" style="margin-left:15px; border-left: 2px solid #ddd; padding-left: 10px;">${c.meaning}</span>
            </div>
        `;
        
        const audioBtn = document.createElement('button');
        audioBtn.innerHTML = '🔊';
        audioBtn.style.background = 'none';
        audioBtn.style.border = 'none';
        audioBtn.style.cursor = 'pointer';
        audioBtn.style.fontSize = '1.3rem';
        audioBtn.style.padding = '5px 10px';
        audioBtn.onclick = () => speakWord(c.word);
        
        li.appendChild(leftDiv);
        li.appendChild(audioBtn);
        listContainer.appendChild(li);
    });
    
    showScreen('screen-flashcard-view');
}

function startFlashcardTestFromView() {
    currentStudySource = "flashcard";
    startFlashcardTestDirectly();
}

function startFlashcardTestDirectly() {
    // Show setup screen inside test screen
    document.getElementById('flashcard-setup-area').classList.remove('hidden');
    document.getElementById('flashcard-test-area').classList.add('hidden');
    document.getElementById('flashcard-test-progress').innerText = `Hazırlanıyor`;
    showScreen('screen-flashcard-test');
}

function launchFlashcardTest(direction) {
    let list = [];
    if (currentStudySource === "wrongWords") {
        list = currentStudyList;
    } else {
        list = appData.flashcards[currentFlashcardListName] || [];
    }
    
    if (list.length === 0) {
        alertMsg("Hata", "Bu listede test edilecek kelime yok.", "error");
        if (currentStudySource === "wrongWords") {
            showStatsAndWrongWordsScreen();
        } else {
            showFlashcardDashboard();
        }
        return;
    }
    
    flashcardTestDirection = direction;
    flashcardTestPool = [...list].sort(() => Math.random() - 0.5);
    flashcardTestIndex = 0;
    flashcardCorrectCount = 0;
    flashcardWrongCards = [];
    
    document.getElementById('flashcard-setup-area').classList.add('hidden');
    document.getElementById('flashcard-test-area').classList.remove('hidden');
    
    renderFlashcardQuestion();
}

function renderFlashcardQuestion() {
    const w = flashcardTestPool[flashcardTestIndex];
    document.getElementById('flashcard-test-progress').innerText = `${flashcardTestIndex + 1} / ${flashcardTestPool.length}`;
    
    // Reset Card Animation & View
    const cardInner = document.getElementById('flashcard-card-inner');
    cardInner.classList.remove('flipped');
    
    const input = document.getElementById('flashcard-answer-input');
    input.value = '';
    input.disabled = false;
    
    const feedback = document.getElementById('flashcard-test-feedback');
    feedback.innerText = '';
    feedback.className = 'game-feedback';
    
    // Set controls
    document.getElementById('btn-flashcard-submit').style.display = 'inline-block';
    document.getElementById('btn-flashcard-next').style.display = 'none';
    document.getElementById('btn-flashcard-skip').style.display = 'inline-block';
    
    // Fill Front & Back card contents
    const frontWord = document.getElementById('flashcard-front-word');
    const frontSub = document.getElementById('flashcard-front-sub');
    
    const backWord = document.getElementById('flashcard-back-word');
    const backSub = document.getElementById('flashcard-back-sub');
    const backMeaning = document.getElementById('flashcard-back-meaning');
    
    if (flashcardTestDirection === 'en-tr') {
        frontWord.innerText = w.word.toUpperCase();
        frontSub.innerText = w.pronunciation || '';
        
        backWord.innerText = w.word.toUpperCase();
        backSub.innerText = w.pronunciation || '';
        backMeaning.innerText = w.meaning;
        
        input.placeholder = "Türkçe anlamını yazın...";
    } else {
        frontWord.innerText = w.meaning;
        frontSub.innerText = '(İngilizcesini Yazın)';
        
        backWord.innerText = w.word.toUpperCase();
        backSub.innerText = w.pronunciation || '';
        backMeaning.innerText = w.meaning;
        
        input.placeholder = "İngilizce kelimeyi yazın...";
    }
    
    setTimeout(() => {
        input.focus();
    }, 200);
}

function flipActiveFlashcard() {
    document.getElementById('flashcard-card-inner').classList.toggle('flipped');
}

function checkTurkishFlashcardMatch(userInput, correctMeaning) {
    return checkTurkishMatch(userInput, correctMeaning);
}

function checkEnglishFlashcardMatch(userInput, correctWord) {
    return checkEnglishMatch(userInput, correctWord);
}

function submitFlashcardAnswer() {
    const input = document.getElementById('flashcard-answer-input');
    const feedback = document.getElementById('flashcard-test-feedback');
    const userVal = input.value.trim();
    
    if (!userVal) return;
    
    const w = flashcardTestPool[flashcardTestIndex];
    let isCorrect = false;
    
    if (flashcardTestDirection === 'en-tr') {
        isCorrect = checkTurkishFlashcardMatch(userVal, w.meaning);
    } else {
        isCorrect = checkEnglishFlashcardMatch(userVal, w.word);
    }
    
    input.disabled = true;
    document.getElementById('btn-flashcard-submit').style.display = 'none';
    document.getElementById('btn-flashcard-skip').style.display = 'none';
    
    if (isCorrect) {
        feedback.innerText = "Doğru! 🎉";
        feedback.className = "game-feedback game-correct";
        flashcardCorrectCount++;
        recordCorrectAnswer();
        
        // Success Sound
        playBubblePopSound();
        
        // Auto-advance after 1.2 seconds
        setTimeout(nextFlashcardQuestion, 1200);
    } else {
        feedback.innerText = "Yanlış! Kart Doğru Cevabı Gösteriyor...";
        feedback.className = "game-feedback game-wrong";
        recordWrongWord(w, 'Flash Kart Sınavı');
        
        // Buzz sound
        playBubbleBuzzSound();
        
        // Flip card to show answer
        const cardInner = document.getElementById('flashcard-card-inner');
        if (!cardInner.classList.contains('flipped')) {
            cardInner.classList.add('flipped');
        }
        
        // Pronounce correct English word online/offline
        speakWord(w.word);
        
        // Show Next button to let user view before clicking
        const nextBtn = document.getElementById('btn-flashcard-next');
        nextBtn.style.display = 'inline-block';
        nextBtn.focus();
    }
}

function skipFlashcardQuestion() {
    const input = document.getElementById('flashcard-answer-input');
    const feedback = document.getElementById('flashcard-test-feedback');
    const w = flashcardTestPool[flashcardTestIndex];
    
    input.disabled = true;
    document.getElementById('btn-flashcard-submit').style.display = 'none';
    document.getElementById('btn-flashcard-skip').style.display = 'none';
    
    feedback.innerText = "Atlandı. Doğru Cevap:";
    feedback.className = "game-feedback game-wrong";
    recordWrongWord(w, 'Flash Kart Sınavı');
    
    const cardInner = document.getElementById('flashcard-card-inner');
    if (!cardInner.classList.contains('flipped')) {
        cardInner.classList.add('flipped');
    }
    
    // Pronounce correct English word
    speakWord(w.word);
    
    const nextBtn = document.getElementById('btn-flashcard-next');
    nextBtn.style.display = 'inline-block';
    nextBtn.focus();
}

function nextFlashcardQuestion() {
    if (flashcardTestIndex < flashcardTestPool.length - 1) {
        flashcardTestIndex++;
        renderFlashcardQuestion();
    } else {
        // Sınav Bitti
        playSuccessSound();
        Swal.fire({
            title: "Sınav Tamamlandı! 🏆",
            html: `<p style="font-size: 1.15rem;">Doğru Sayısı: <strong>${flashcardCorrectCount} / ${flashcardTestPool.length}</strong></p>`,
            icon: "success",
            confirmButtonColor: themes[currentLang].primary
        }).then(() => {
            if (currentStudySource === "wrongWords") {
                showStatsAndWrongWordsScreen();
            } else {
                showFlashcardDashboard();
            }
        });
    }
}

function confirmEndFlashcardTest() {
    Swal.fire({
        title: "Sınavı bitirmek istiyor musunuz?",
        text: "Sınav yarıda kesilecektir.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Evet, Bitir",
        cancelButtonText: "İptal"
    }).then((result) => {
        if(result.isConfirmed) {
            if (currentStudySource === "wrongWords") {
                showStatsAndWrongWordsScreen();
            } else {
                showFlashcardDashboard();
            }
        }
    });
}

// --- STATISTICS & WRONG WORDS ---
let currentWrongWordsDate = "";
let currentStudySource = "flashcard"; // "flashcard" or "wrongWords"
let currentStudyList = [];

async function recordCorrectAnswer() {
    if (!appData.stats) appData.stats = { correct: 0, wrong: 0 };
    appData.stats.correct = (appData.stats.correct || 0) + 1;
    await saveData();
}

async function recordWrongWord(wordObj, source) {
    if (!appData.stats) appData.stats = { correct: 0, wrong: 0 };
    appData.stats.wrong = (appData.stats.wrong || 0) + 1;
    
    if (!appData.wrongWords) appData.wrongWords = {};
    const today = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (!appData.wrongWords[today]) {
        appData.wrongWords[today] = [];
    }
    
    // Check if the word is already in the list for today to avoid duplicate entries
    const exists = appData.wrongWords[today].some(w => w.word.toLowerCase() === wordObj.word.toLowerCase());
    if (!exists) {
        appData.wrongWords[today].push({
            word: wordObj.word,
            meaning: wordObj.meaning || wordObj.translation || "",
            pronunciation: wordObj.pronunciation || "",
            context: wordObj.context || "",
            source: source,
            timestamp: Date.now()
        });
    }
    await saveData();
}

async function resetStats() {
    Swal.fire({
        title: "Emin misiniz?",
        text: "Tüm doğru/yanlış istatistikleri sıfırlanacaktır.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Evet, Sıfırla",
        cancelButtonText: "İptal",
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if(result.isConfirmed) {
            appData.stats = { correct: 0, wrong: 0 };
            await saveData();
            showStatsAndWrongWordsScreen();
            alertMsg("Sıfırlandı", "İstatistikler sıfırlandı.");
        }
    });
}

function showStatsAndWrongWordsScreen() {
    if (!appData.stats) appData.stats = { correct: 0, wrong: 0 };
    const correct = appData.stats.correct || 0;
    const wrong = appData.stats.wrong || 0;
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    
    document.getElementById('stats-correct-count').innerText = correct;
    document.getElementById('stats-wrong-count').innerText = wrong;
    document.getElementById('stats-accuracy').innerText = accuracy + "%";
    
    renderWrongDates();
    showScreen('screen-stats-wrong-words');
}

function renderWrongDates() {
    const container = document.getElementById('wrong-dates-container');
    container.innerHTML = '';
    
    const wrongWordsObj = appData.wrongWords || {};
    const dates = Object.keys(wrongWordsObj).sort((a,b) => {
        return b.localeCompare(a);
    });
    
    const activeDates = dates.filter(d => wrongWordsObj[d] && wrongWordsObj[d].length > 0);
    
    if (activeDates.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">Henüz hatalı bilinen kelime kaydedilmemiş.</p>';
    } else {
        activeDates.forEach(dateStr => {
            const wordCount = wrongWordsObj[dateStr].length;
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            
            const contentDiv = document.createElement('div');
            contentDiv.style.flex = '1';
            contentDiv.innerHTML = `<h3>${dateStr}</h3><span>${wordCount} Yanlış Kelime</span>`;
            contentDiv.onclick = () => showWrongWordsOfDate(dateStr);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-primary';
            deleteBtn.style.background = '#e74c3c';
            deleteBtn.style.padding = '6px 12px';
            deleteBtn.style.fontSize = '0.85rem';
            deleteBtn.style.borderRadius = '6px';
            deleteBtn.style.marginLeft = '15px';
            deleteBtn.innerText = 'Tarihi Sil';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteWrongWordDate(dateStr);
            };
            
            div.appendChild(contentDiv);
            div.appendChild(deleteBtn);
            container.appendChild(div);
        });
    }
}

function showWrongWordsOfDate(dateStr) {
    currentWrongWordsDate = dateStr;
    document.getElementById('wrong-words-date-title').innerText = `${dateStr} Yanlışları`;
    
    renderWrongWordsList();
    showScreen('screen-wrong-words-study');
}

function renderWrongWordsList() {
    const listContainer = document.getElementById('wrong-words-list');
    listContainer.innerHTML = '';
    
    const list = appData.wrongWords[currentWrongWordsDate] || [];
    list.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'word-row';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        
        const leftDiv = document.createElement('div');
        leftDiv.innerHTML = `<span class="word-main">${item.word}</span> <span class="word-meaning">${item.meaning}</span> <span style="font-size:0.8rem; color:#999; margin-left: 10px;">(${item.source || ''})</span>`;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '8px';
        
        const audioBtn = document.createElement('button');
        audioBtn.className = 'btn-audio-mini';
        audioBtn.innerHTML = '🔊';
        audioBtn.onclick = () => speakWord(item.word);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-primary';
        deleteBtn.style.background = '#e74c3c';
        deleteBtn.style.padding = '6px 12px';
        deleteBtn.style.fontSize = '0.85rem';
        deleteBtn.style.borderRadius = '6px';
        deleteBtn.innerText = 'Sil';
        deleteBtn.onclick = () => deleteWrongWord(currentWrongWordsDate, item.word);
        
        btnGroup.appendChild(audioBtn);
        btnGroup.appendChild(deleteBtn);
        
        li.appendChild(leftDiv);
        li.appendChild(btnGroup);
        listContainer.appendChild(li);
    });
}

function deleteWrongWord(dateStr, wordText) {
    if (!appData.wrongWords || !appData.wrongWords[dateStr]) return;
    
    appData.wrongWords[dateStr] = appData.wrongWords[dateStr].filter(w => w.word.toLowerCase() !== wordText.toLowerCase());
    saveData().then(() => {
        renderWrongWordsList();
        renderWrongDates();
    });
}

function deleteWrongWordDate(dateStr) {
    Swal.fire({
        title: "Emin misiniz?",
        text: `"${dateStr}" tarihindeki tüm yanlış kelimeler silinecektir.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Evet, Sil",
        cancelButtonText: "İptal",
        confirmButtonColor: themes[currentLang].primary
    }).then(async (result) => {
        if(result.isConfirmed) {
            delete appData.wrongWords[dateStr];
            await saveData();
            renderWrongDates();
            alertMsg("Silindi", "Tarih ve kelimeler silindi.");
        }
    });
}

function startWrongWordsStudy() {
    const list = appData.wrongWords[currentWrongWordsDate] || [];
    if (list.length === 0) {
        alertMsg("Hata", "Bu listede çalışılacak kelime yok.", "error");
        return;
    }
    
    currentStudySource = "wrongWords";
    currentStudyList = list;
    
    startFlashcardTestDirectly();
}


// ==========================================
// JAPONCA (JAPANESE) MODÜLÜ EK FONKSİYONLARI
// ==========================================

let writingCanvas, writingCtx;
let isDrawing = false;
let lastX = 0, lastY = 0;
let brushColor = '#2c3e50';
let brushSize = 8;
let isGridVisible = true;
let currentWritingAlphabet = 'hiragana';
let currentWritingIndex = 0;

function showWritingPractice() {
    showScreen('screen-japanese-writing');
    initWritingCanvas();
    loadWritingChar();
}

function initWritingCanvas() {
    writingCanvas = document.getElementById('writing-canvas');
    if (!writingCanvas) return;
    writingCtx = writingCanvas.getContext('2d');
    setupCanvasListeners(writingCanvas, writingCtx);
    clearWritingCanvas();
}

function setupCanvasListeners(canvas, ctx) {
    // Mouse Events
    canvas.onmousedown = (e) => startDrawing(e, canvas, ctx);
    canvas.onmousemove = (e) => draw(e, canvas, ctx);
    canvas.onmouseup = () => stopDrawing();
    canvas.onmouseleave = () => stopDrawing();
    
    // Touch Events (Tablet Stylus/Touch Support)
    canvas.ontouchstart = (e) => {
        e.preventDefault();
        const t = e.touches[0];
        startDrawing(t, canvas, ctx);
    };
    canvas.ontouchmove = (e) => {
        e.preventDefault();
        const t = e.touches[0];
        draw(t, canvas, ctx);
    };
    canvas.ontouchend = () => stopDrawing();
}

function startDrawing(e, canvas, ctx) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.arc(lastX, lastY, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = brushColor;
    ctx.fill();
}

function draw(e, canvas, ctx) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    lastX = x;
    lastY = y;
}

function stopDrawing() {
    isDrawing = false;
}

function clearWritingCanvas() {
    if (writingCtx && writingCanvas) {
        writingCtx.clearRect(0, 0, writingCanvas.width, writingCanvas.height);
    }
}

function toggleCanvasGrid() {
    isGridVisible = !isGridVisible;
    const grid = document.getElementById('canvas-grid-lines');
    const btn = document.getElementById('btn-toggle-grid');
    if (isGridVisible) {
        grid.classList.remove('hidden');
        btn.innerText = 'Izgarayı Gizle';
    } else {
        grid.classList.add('hidden');
        btn.innerText = 'Izgarayı Göster';
    }
}

function updateBrushThickness(val) {
    brushSize = parseInt(val);
}

function setBrushColor(color, element) {
    brushColor = color;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    element.classList.add('active');
}

function setWritingMode(mode) {
    currentWritingAlphabet = mode;
    currentWritingIndex = 0;
    document.querySelectorAll('#screen-japanese-writing .btn-sub-tab').forEach(b => {
        if (b.innerText.toLowerCase() === mode) b.classList.add('active');
        else b.classList.remove('active');
    });
    loadWritingChar();
}

function loadWritingChar() {
    const list = JAPANESE_DATABASE[currentWritingAlphabet];
    if (!list || list.length === 0) return;
    const item = list[currentWritingIndex];
    
    document.getElementById('writing-char-large').innerText = item.char;
    document.getElementById('writing-char-romaji').innerText = item.romaji;
    document.getElementById('writing-char-strokes').innerText = item.strokeCount;
    document.getElementById('writing-char-assoc').innerText = item.association || 'Yok';
    document.getElementById('writing-char-story').innerText = item.memoryText || '';
    document.getElementById('writing-char-index').innerText = `${currentWritingIndex + 1} / ${list.length}`;
    
    const meaningBlock = document.getElementById('writing-char-meaning-block');
    if (currentWritingAlphabet === 'kanji') {
        meaningBlock.classList.remove('hidden');
        document.getElementById('writing-char-meaning').innerText = item.meaning;
    } else {
        meaningBlock.classList.add('hidden');
    }
    clearWritingCanvas();
}

function prevWritingChar() {
    const list = JAPANESE_DATABASE[currentWritingAlphabet];
    currentWritingIndex = (currentWritingIndex - 1 + list.length) % list.length;
    loadWritingChar();
}

function nextWritingChar() {
    const list = JAPANESE_DATABASE[currentWritingAlphabet];
    currentWritingIndex = (currentWritingIndex + 1) % list.length;
    loadWritingChar();
}

// 🧠 HAFIZA KARTLARI
let currentMemoryAlphabet = 'hiragana';

function showMemoryCards() {
    showScreen('screen-japanese-memory');
    setMemoryMode('hiragana');
}

function setMemoryMode(mode) {
    currentMemoryAlphabet = mode;
    document.querySelectorAll('#screen-japanese-memory .btn-sub-tab').forEach(b => {
        if (b.innerText.toLowerCase() === mode) b.classList.add('active');
        else b.classList.remove('active');
    });
    loadMemoryCards();
}

function loadMemoryCards() {
    const container = document.getElementById('memory-grid-container');
    if (!container) return;
    container.innerHTML = '';
    const list = JAPANESE_DATABASE[currentMemoryAlphabet];
    if (!list) return;
    
    list.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'flip-card';
        card.onclick = () => card.classList.toggle('flipped');
        
        let frontContent = `
            <div class="flip-card-front">
                <div class="card-char">${item.char}</div>
                <div class="card-romaji">${item.romaji}</div>
            </div>
        `;
        
        let backContent = `
            <div class="flip-card-back">
                <strong>${item.char} (${item.romaji})</strong>
                ${currentMemoryAlphabet === 'kanji' ? `<p><strong>Anlamı:</strong> ${item.meaning}</p>` : ''}
                <p class="memory-assoc">💡 ${item.association || ''}</p>
                <p class="memory-text">${item.memoryText || ''}</p>
            </div>
        `;
        
        card.innerHTML = `
            <div class="flip-card-inner">
                ${frontContent}
                ${backContent}
            </div>
        `;
        container.appendChild(card);
    });
}

// 🧩 MATRİS ALIŞTIRMALARI
let currentMatrixType = 'reading'; 
let matrixQuestions = []; 
let matrixUserAnswers = []; 
let selectedMatrixIndex = -1;

function showMatrixExercises() {
    showScreen('screen-japanese-matrix');
    setMatrixType('reading');
}

function setMatrixType(type) {
    currentMatrixType = type;
    document.querySelectorAll('#screen-japanese-matrix .btn-sub-tab').forEach(b => {
        if (type === 'reading' && b.innerText.includes('Okuma')) b.classList.add('active');
        else if (type === 'writing' && b.innerText.includes('Yazma')) b.classList.add('active');
        else b.classList.remove('active');
    });
    generateMatrixExercise();
}

function generateMatrixExercise() {
    const list = JAPANESE_DATABASE.hiragana.filter(h => h.romaji.length <= 3 && !h.char.includes('が') && !h.char.includes('ぱ'));
    matrixQuestions = [];
    matrixUserAnswers = Array(20).fill('');
    
    for (let i = 0; i < 20; i++) {
        const rand = list[Math.floor(Math.random() * list.length)];
        matrixQuestions.push(rand);
    }
    
    renderMatrixGrids();
    updateMatrixScore();
}

function renderMatrixGrids() {
    const sourceGrid = document.getElementById('matrix-source-grid');
    const targetGrid = document.getElementById('matrix-target-grid');
    if (!sourceGrid || !targetGrid) return;
    
    sourceGrid.innerHTML = '';
    targetGrid.innerHTML = '';
    
    matrixQuestions.forEach((item, index) => {
        const srcCell = document.createElement('div');
        srcCell.className = 'matrix-cell';
        if (currentMatrixType === 'reading') {
            srcCell.innerText = item.char;
        } else {
            srcCell.innerText = item.romaji;
        }
        sourceGrid.appendChild(srcCell);
        
        const tgtCell = document.createElement('div');
        tgtCell.className = 'matrix-cell empty';
        tgtCell.id = `matrix-target-cell-${index}`;
        tgtCell.onclick = () => openMatrixKeypad(index);
        
        if (matrixUserAnswers[index]) {
            tgtCell.innerText = matrixUserAnswers[index];
            tgtCell.classList.remove('empty');
            
            const isCorrect = validateMatrixCell(index);
            if (isCorrect) {
                tgtCell.classList.add('correct');
            } else {
                tgtCell.classList.add('wrong');
            }
        }
        targetGrid.appendChild(tgtCell);
    });
}

function validateMatrixCell(index) {
    const q = matrixQuestions[index];
    const ans = matrixUserAnswers[index];
    if (currentMatrixType === 'reading') {
        return ans.toLowerCase().trim() === q.romaji.toLowerCase().trim();
    } else {
        return ans === q.char;
    }
}

function openMatrixKeypad(index) {
    selectedMatrixIndex = index;
    const modal = document.getElementById('matrix-keypad-modal');
    const container = document.getElementById('keypad-options-container');
    if (!modal || !container) return;
    container.innerHTML = '';
    
    const correctItem = matrixQuestions[index];
    let options = [correctItem];
    
    const pool = JAPANESE_DATABASE.hiragana.filter(h => h.romaji.length <= 3 && !h.char.includes('が') && !h.char.includes('ぱ'));
    
    while (options.length < 8) {
        const rand = pool[Math.floor(Math.random() * pool.length)];
        if (!options.some(o => o.char === rand.char)) {
            options.push(rand);
        }
    }
    
    options.sort(() => Math.random() - 0.5);
    
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'keypad-btn';
        if (currentMatrixType === 'reading') {
            btn.innerText = opt.romaji;
            btn.onclick = () => selectMatrixKeypadValue(opt.romaji);
        } else {
            btn.innerText = opt.char;
            btn.onclick = () => selectMatrixKeypadValue(opt.char);
        }
        container.appendChild(btn);
    });
    
    modal.classList.remove('hidden');
}

function selectMatrixKeypadValue(val) {
    matrixUserAnswers[selectedMatrixIndex] = val;
    closeMatrixKeypad();
    renderMatrixGrids();
    updateMatrixScore();
}

function closeMatrixKeypad() {
    const modal = document.getElementById('matrix-keypad-modal');
    if (modal) modal.classList.add('hidden');
}

function updateMatrixScore() {
    let correct = 0;
    matrixUserAnswers.forEach((ans, idx) => {
        if (ans && validateMatrixCell(idx)) {
            correct++;
        }
    });
    const info = document.getElementById('matrix-score-info');
    if (info) info.innerText = `Puan: ${correct} / 20`;
}

// 🤝 KARAKTER EŞLEŞTİRME OYUNU
let matchingMode = 'hiragana';
let selectedMatchChar = null;
let selectedMatchRomaji = null;
let matchedPairsCount = 0;

function showMatchingGame() {
    showScreen('screen-japanese-matching');
    setMatchingMode('hiragana');
}

function setMatchingMode(mode) {
    matchingMode = mode;
    document.querySelectorAll('#screen-japanese-matching .btn-sub-tab').forEach(b => {
        if (b.innerText.toLowerCase() === mode) b.classList.add('active');
        else b.classList.remove('active');
    });
    startMatchingGameRound();
}

function startMatchingGameRound() {
    selectedMatchChar = null;
    selectedMatchRomaji = null;
    matchedPairsCount = 0;
    document.getElementById('matching-success-message').classList.add('hidden');
    
    const pool = JAPANESE_DATABASE[matchingMode];
    if (!pool || pool.length < 5) return;
    
    let selected = [];
    let indices = [];
    while (selected.length < 5) {
        const idx = Math.floor(Math.random() * pool.length);
        if (!indices.includes(idx)) {
            indices.push(idx);
            selected.push(pool[idx]);
        }
    }
    
    const charsCol = document.getElementById('matching-chars-column');
    charsCol.innerHTML = '<h3>Karakter</h3>';
    const shuffledChars = [...selected].sort(() => Math.random() - 0.5);
    shuffledChars.forEach(item => {
        const div = document.createElement('div');
        div.className = 'matching-card';
        div.innerText = item.char;
        div.dataset.romaji = item.romaji;
        div.onclick = () => selectMatchingCharCard(div);
        charsCol.appendChild(div);
    });
    
    const romajiCol = document.getElementById('matching-romaji-column');
    romajiCol.innerHTML = '<h3>Okunuş (Latin)</h3>';
    const shuffledRomaji = [...selected].sort(() => Math.random() - 0.5);
    shuffledRomaji.forEach(item => {
        const div = document.createElement('div');
        div.className = 'matching-card';
        div.innerText = matchingMode === 'kanji' ? `${item.romaji} (${item.meaning})` : item.romaji;
        div.dataset.romaji = item.romaji;
        div.onclick = () => selectMatchingRomajiCard(div);
        romajiCol.appendChild(div);
    });
}

function selectMatchingCharCard(card) {
    if (card.classList.contains('matched')) return;
    document.querySelectorAll('#matching-chars-column .matching-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedMatchChar = card;
    checkMatchingPair();
}

function selectMatchingRomajiCard(card) {
    if (card.classList.contains('matched')) return;
    document.querySelectorAll('#matching-romaji-column .matching-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedMatchRomaji = card;
    checkMatchingPair();
}

function checkMatchingPair() {
    if (!selectedMatchChar || !selectedMatchRomaji) return;
    
    const charRomaji = selectedMatchChar.dataset.romaji;
    const romajiVal = selectedMatchRomaji.dataset.romaji;
    
    if (charRomaji === romajiVal) {
        selectedMatchChar.classList.remove('selected');
        selectedMatchRomaji.classList.remove('selected');
        selectedMatchChar.classList.add('matched');
        selectedMatchRomaji.classList.add('matched');
        
        selectedMatchChar = null;
        selectedMatchRomaji = null;
        matchedPairsCount++;
        
        if (matchedPairsCount === 5) {
            document.getElementById('matching-success-message').classList.remove('hidden');
        }
    } else {
        const tempChar = selectedMatchChar;
        const tempRomaji = selectedMatchRomaji;
        tempChar.classList.add('wrong');
        tempRomaji.classList.add('wrong');
        
        selectedMatchChar = null;
        selectedMatchRomaji = null;
        
        setTimeout(() => {
            tempChar.classList.remove('selected', 'wrong');
            tempRomaji.classList.remove('selected', 'wrong');
        }, 600);
    }
}

// 🔄 YAZIM & ÇİZİM SINAVI
let jpQuizMode = 'reading'; 
let jpQuizQuestions = [];
let jpQuizCurrentIdx = 0;
let jpQuizScore = 0;
let quizCanvas, quizCtx, quizRefCanvas, quizRefCtx;
let isQuizDrawing = false;
let lastQuizX = 0, lastQuizY = 0;

function showWritingQuiz() {
    showScreen('screen-japanese-quiz');
    document.getElementById('quiz-init-view').classList.remove('hidden');
    document.getElementById('quiz-active-view').classList.add('hidden');
    document.getElementById('quiz-result-view').classList.add('hidden');
}

function startJpQuiz(mode) {
    jpQuizMode = mode;
    jpQuizCurrentIdx = 0;
    jpQuizScore = 0;
    
    const list = [...JAPANESE_DATABASE.hiragana];
    list.sort(() => Math.random() - 0.5);
    jpQuizQuestions = list.slice(0, 10);
    
    document.getElementById('quiz-init-view').classList.add('hidden');
    document.getElementById('quiz-active-view').classList.remove('hidden');
    
    if (mode === 'drawing') {
        document.getElementById('quiz-canvas-panel').classList.remove('hidden');
        document.getElementById('quiz-input-container').classList.add('hidden');
        document.getElementById('quiz-draw-actions').classList.remove('hidden');
        initQuizCanvas();
    } else {
        document.getElementById('quiz-canvas-panel').classList.add('hidden');
        document.getElementById('quiz-input-container').classList.remove('hidden');
        document.getElementById('quiz-draw-actions').classList.add('hidden');
    }
    
    loadJpQuizQuestion();
}

function initQuizCanvas() {
    quizCanvas = document.getElementById('quiz-canvas');
    if (!quizCanvas) return;
    quizCtx = quizCanvas.getContext('2d');
    quizRefCanvas = document.getElementById('quiz-ref-canvas');
    quizRefCtx = quizRefCanvas.getContext('2d');
    
    setupCanvasListeners(quizCanvas, quizCtx);
    clearQuizCanvas();
}

function clearQuizCanvas() {
    if (quizCtx && quizCanvas) {
        quizCtx.clearRect(0, 0, quizCanvas.width, quizCanvas.height);
    }
    if (quizRefCtx && quizRefCanvas) {
        quizRefCtx.clearRect(0, 0, quizRefCanvas.width, quizRefCanvas.height);
        quizRefCanvas.classList.add('hidden');
    }
}

function loadJpQuizQuestion() {
    const q = jpQuizQuestions[jpQuizCurrentIdx];
    document.getElementById('quiz-progress-text').innerText = `Soru ${jpQuizCurrentIdx + 1} / 10`;
    document.getElementById('quiz-feedback-box').classList.add('hidden');
    
    if (jpQuizMode === 'reading') {
        document.getElementById('quiz-question-prompt').innerText = q.char;
        document.getElementById('quiz-question-subtext').innerText = 'Bu harfin Latin alfabesindeki karşılığını yazın:';
        document.getElementById('quiz-text-answer').value = '';
        document.getElementById('quiz-text-answer').disabled = false;
        document.getElementById('quiz-text-answer').focus();
        document.getElementById('quiz-input-container').classList.remove('hidden');
    } else {
        document.getElementById('quiz-question-prompt').innerText = q.romaji.toUpperCase();
        document.getElementById('quiz-question-subtext').innerText = 'Bu okunuşa sahip Hiragana karakterini sağdaki tuvale çizin:';
        document.getElementById('quiz-draw-actions').classList.remove('hidden');
        clearQuizCanvas();
    }
}

function submitJpQuizAnswer() {
    const q = jpQuizQuestions[jpQuizCurrentIdx];
    const userAns = document.getElementById('quiz-text-answer').value.trim().toLowerCase();
    document.getElementById('quiz-text-answer').disabled = true;
    
    const isCorrect = userAns === q.romaji.toLowerCase();
    if (isCorrect) {
        jpQuizScore++;
        showJpQuizFeedback(true, 'Doğru!', q.memoryText);
    } else {
        showJpQuizFeedback(false, `Yanlış! (Doğru Cevap: ${q.romaji})`, q.memoryText);
    }
}

function finishDrawingQuiz() {
    const q = jpQuizQuestions[jpQuizCurrentIdx];
    document.getElementById('quiz-draw-actions').classList.add('hidden');
    
    quizRefCtx.clearRect(0, 0, quizRefCanvas.width, quizRefCanvas.height);
    quizRefCtx.font = '220px "Outfit", "Inter", sans-serif';
    quizRefCtx.textAlign = 'center';
    quizRefCtx.textBaseline = 'middle';
    quizRefCtx.fillStyle = 'rgba(231, 76, 60, 0.45)'; 
    quizRefCtx.fillText(q.char, quizRefCanvas.width / 2, quizRefCanvas.height / 2);
    
    quizRefCanvas.classList.remove('hidden');
    showJpQuizFeedback(null, 'Çiziminizi Karşılaştırın', q.memoryText);
}

function showJpQuizFeedback(correct, title, story) {
    const fBox = document.getElementById('quiz-feedback-box');
    const icon = document.getElementById('quiz-feedback-icon');
    const fTitle = document.getElementById('quiz-feedback-title');
    const fStory = document.getElementById('quiz-feedback-story');
    const nextBtn = document.getElementById('btn-quiz-next');
    
    fStory.innerText = story || '';
    fTitle.innerText = title;
    
    if (correct === true) {
        icon.innerText = '✅';
        fBox.style.borderLeft = '5px solid #2ecc71';
        nextBtn.classList.remove('hidden');
    } else if (correct === false) {
        icon.innerText = '❌';
        fBox.style.borderLeft = '5px solid #e74c3c';
        nextBtn.classList.remove('hidden');
    } else {
        icon.innerText = '🎨';
        fBox.style.borderLeft = '5px solid #3498db';
        fStory.innerHTML = `
            <p>${story}</p>
            <p style="margin-top: 10px; font-weight: 600;">Çiziminiz kırmızı şablona benziyor mu?</p>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <button class="btn-primary" onclick="gradeDrawingQuiz(true)" style="background: #2ecc71; flex:1;">Doğru Çizdim</button>
                <button class="btn-primary" onclick="gradeDrawingQuiz(false)" style="background: #e74c3c; flex:1;">Yanlış Çizdim</button>
            </div>
        `;
        nextBtn.classList.add('hidden');
    }
    
    fBox.classList.remove('hidden');
}

function gradeDrawingQuiz(correct) {
    if (correct) {
        jpQuizScore++;
    }
    nextJpQuizQuestion();
}

function nextJpQuizQuestion() {
    jpQuizCurrentIdx++;
    if (jpQuizCurrentIdx < 10) {
        loadJpQuizQuestion();
    } else {
        showJpQuizResults();
    }
}

function showJpQuizResults() {
    document.getElementById('quiz-active-view').classList.add('hidden');
    document.getElementById('quiz-result-view').classList.remove('hidden');
    document.getElementById('quiz-score-text').innerText = `Skor: 10 sorudan ${jpQuizScore} Doğru`;
}

function restartJpQuiz() {
    startJpQuiz(jpQuizMode);
}

// ✍️ ALFABE TEST MERKEZİ (DİNAMİK ÇOKTAN SEÇMELİ TEST)
let jpTestQuestions = [];
let jpTestCurrentIdx = 0;
let jpTestScore = 0;

function showAlphabetTest() {
    showScreen('screen-japanese-alphabet-test');
    document.getElementById('jp-test-setup-view').classList.remove('hidden');
    document.getElementById('jp-test-active-view').classList.add('hidden');
    document.getElementById('jp-test-result-view').classList.add('hidden');
}

function startJpAlphabetTest() {
    const alphabet = document.getElementById('jp-test-setup-alphabet').value;
    const countSel = document.getElementById('jp-test-setup-count').value;
    
    let pool = [];
    if (alphabet === 'mix') {
        pool = [...JAPANESE_DATABASE.hiragana, ...JAPANESE_DATABASE.katakana, ...JAPANESE_DATABASE.kanji];
    } else {
        pool = [...JAPANESE_DATABASE[alphabet]];
    }
    
    pool.sort(() => Math.random() - 0.5);
    
    let count = countSel === 'all' ? pool.length : parseInt(countSel);
    jpTestQuestions = pool.slice(0, count);
    jpTestCurrentIdx = 0;
    jpTestScore = 0;
    
    document.getElementById('jp-test-setup-view').classList.add('hidden');
    document.getElementById('jp-test-active-view').classList.remove('hidden');
    
    loadJpAlphabetQuestion();
}

function confirmEndJpAlphabetTest() {
    Swal.fire({
        title: 'Testten Çıkmak İstiyor musunuz?',
        text: 'İlerlemeniz kaydedilmeyecektir.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Evet, Çık',
        cancelButtonText: 'İptal',
        confirmButtonColor: '#ff4d6d'
    }).then((result) => {
        if (result.isConfirmed) {
            showAlphabetTest();
        }
    });
}

function loadJpAlphabetQuestion() {
    const q = jpTestQuestions[jpTestCurrentIdx];
    document.getElementById('jp-test-progress').innerText = `${jpTestCurrentIdx + 1} / ${jpTestQuestions.length}`;
    document.getElementById('jp-test-feedback').classList.add('hidden');
    document.getElementById('btn-next-jp-question').classList.add('hidden').style.display = 'none';
    
    const container = document.getElementById('jp-test-question-container');
    if (!container) return;
    container.innerHTML = '';
    
    const isTypeA = Math.random() > 0.5;
    
    const title = document.createElement('h2');
    if (isTypeA) {
        title.innerHTML = `<span style="font-size: 4rem; display:block; margin-bottom:10px;">${q.char}</span> karakterinin Latin alfabesindeki karşılığı nedir?`;
    } else {
        const term = q.meaning ? `${q.romaji} (${q.meaning})` : q.romaji;
        title.innerHTML = `Okunuşu/karşılığı <strong style="color:var(--primary-color); font-size: 1.5rem;">"${term}"</strong> olan karakter hangisidir?`;
    }
    container.appendChild(title);
    
    const fullPool = [...JAPANESE_DATABASE.hiragana, ...JAPANESE_DATABASE.katakana, ...JAPANESE_DATABASE.kanji];
    let choices = [q];
    while (choices.length < 4) {
        const rand = fullPool[Math.floor(Math.random() * fullPool.length)];
        if (!choices.some(c => c.char === rand.char)) {
            choices.push(rand);
        }
    }
    
    choices.sort(() => Math.random() - 0.5);
    
    const grid = document.createElement('div');
    grid.className = 'choices-grid';
    
    choices.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        if (isTypeA) {
            btn.innerText = opt.meaning ? `${opt.romaji} (${opt.meaning})` : opt.romaji;
        } else {
            btn.innerText = opt.char;
        }
        
        btn.onclick = () => selectJpAlphabetChoice(btn, opt === q);
        grid.appendChild(btn);
    });
    
    container.appendChild(grid);
}

function selectJpAlphabetChoice(button, isCorrect) {
    document.querySelectorAll('.choices-grid .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.innerText === button.innerText) {
            if (isCorrect) {
                btn.classList.add('correct');
            } else {
                btn.classList.add('wrong');
            }
        }
    });
    
    if (!isCorrect) {
        const correctItem = jpTestQuestions[jpTestCurrentIdx];
        const promptIsChar = document.querySelector('.question-container h2 span') !== null;
        document.querySelectorAll('.choices-grid .choice-btn').forEach(btn => {
            if (promptIsChar) {
                const targetText = correctItem.meaning ? `${correctItem.romaji} (${correctItem.meaning})` : correctItem.romaji;
                if (btn.innerText === targetText) {
                    btn.classList.add('correct');
                }
            } else {
                if (btn.innerText === correctItem.char) {
                    btn.classList.add('correct');
                }
            }
        });
    }
    
    if (isCorrect) {
        jpTestScore++;
    }
    
    const q = jpTestQuestions[jpTestCurrentIdx];
    const feedback = document.getElementById('jp-test-feedback');
    if (feedback) {
        document.getElementById('jp-test-feedback-text').innerText = `${q.char} (${q.romaji}): ${q.memoryText}`;
        feedback.classList.remove('hidden');
    }
    
    const nextBtn = document.getElementById('btn-next-jp-question');
    if (nextBtn) {
        nextBtn.classList.remove('hidden');
        nextBtn.style.display = 'block';
    }
}

function nextJpAlphabetQuestion() {
    jpTestCurrentIdx++;
    if (jpTestCurrentIdx < jpTestQuestions.length) {
        loadJpAlphabetQuestion();
    } else {
        showJpAlphabetTestResults();
    }
}

function showJpAlphabetTestResults() {
    document.getElementById('jp-test-active-view').classList.add('hidden');
    document.getElementById('jp-test-result-view').classList.remove('hidden');
    document.getElementById('jp-test-score-text').innerText = `${jpTestQuestions.length} sorudan ${jpTestScore} doğru, ${jpTestQuestions.length - jpTestScore} yanlış yaptınız.`;
}

function restartJpAlphabetTest() {
    startJpAlphabetTest();
}

// --- OTHER WORKSPACE NAVIGATION & DATA ---
function showOtherWorkspace() {
    showScreen('screen-other-workspace');
}

// OTHER WORD PARSER (FORMAT 2)
async function handleOtherWordUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    showLoading("Word belgesi okunuyor...");
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
        const text = result.value;
        parseOtherWordDocument(text);
        
        // Reset file input
        e.target.value = '';
    } catch (error) {
        console.error(error);
        alertMsg("Hata", "Dosya okunurken bir hata oluştu.", "error");
        hideLoading();
    }
}

function splitEnglishTurkishSentence(sentenceLine) {
    // Look for first occurrence of . or ? or ! followed by space
    const match = sentenceLine.match(/^(.+?[\.\?\!])\s+(.+)$/);
    if (match) {
        return {
            sentenceEn: match[1].trim(),
            sentenceTr: match[2].trim()
        };
    }
    return {
        sentenceEn: sentenceLine,
        sentenceTr: ""
    };
}

function parseOtherWordDocument(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let parsedWords = [];
    
    // Regex for word line
    // e.g. "image (imidj) - görüntü, imaj (isim)"
    // or "imply (implay) - ima etmek (fiil)"
    const wordLineRegex = /^([a-zA-ZğüşıöçĞÜŞİÖÇ\s\-'\’]+)\s*\(([^)]+)\)\s*(?:-|–)\s*(.+)$/;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const match = line.match(wordLineRegex);
        
        if (match) {
            let rawWord = match[1].trim();
            let pronunciation = match[2].trim();
            let meaningPart = match[3].trim();
            
            // Extract part of speech from the end of meaning if it exists in parentheses
            let type = "";
            const typeMatch = meaningPart.match(/\(([^)]+)\)$/);
            if (typeMatch) {
                type = typeMatch[1].trim();
                meaningPart = meaningPart.replace(/\(([^)]+)\)$/, "").trim();
            }
            
            // Next line (Line B): English-Turkish Sentence
            let sentenceEn = "";
            let sentenceTr = "";
            if (i + 1 < lines.length) {
                let sentenceLine = lines[i + 1];
                if (!sentenceLine.match(wordLineRegex)) {
                    const splitSent = splitEnglishTurkishSentence(sentenceLine);
                    sentenceEn = splitSent.sentenceEn;
                    sentenceTr = splitSent.sentenceTr;
                    i++; // consume line B
                }
            }
            
            // Next line (Line C): Turkish sentence with English word
            let sentenceTrWithEnWord = "";
            if (i + 1 < lines.length) {
                let thirdLine = lines[i + 1];
                if (!thirdLine.match(wordLineRegex)) {
                    sentenceTrWithEnWord = thirdLine;
                    i++; // consume line C
                }
            }
            
            parsedWords.push({
                word: rawWord,
                pronunciation: pronunciation,
                meaning: meaningPart,
                type: type,
                sentenceEn: sentenceEn,
                sentenceTr: sentenceTr,
                sentenceTrWithEnWord: sentenceTrWithEnWord
            });
        }
    }
    
    if (parsedWords.length > 0) {
        const today = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
        const listName = `${today} Listesi`;
        
        if (!appData.otherWords) appData.otherWords = {};
        if (!appData.otherWords[listName]) appData.otherWords[listName] = [];
        appData.otherWords[listName] = appData.otherWords[listName].concat(parsedWords);
        
        saveData().then(() => {
            hideLoading();
            alertMsg("Başarılı", `${parsedWords.length} kelime başarıyla eklendi!`);
            if (document.getElementById('screen-other-word-dates').classList.contains('active')) {
                renderOtherWordLists();
            }
        });
    } else {
        hideLoading();
        alertMsg("Hata", "Belgede uygun formatta kelime bulunamadı. Lütfen Word şablonunu kontrol edin.", "warning");
    }
}

// OTHER WORDS VIEWING
function showOtherWordLists() {
    showScreen('screen-other-word-dates');
    renderOtherWordLists();
}

function renderOtherWordLists() {
    const container = document.getElementById('other-date-list-container');
    container.innerHTML = '';
    
    if (!appData.otherWords || Object.keys(appData.otherWords).length === 0) {
        container.innerHTML = '<div class="no-data-msg">Henüz yüklenmiş kelime listesi bulunmuyor.</div>';
        return;
    }
    
    const dates = Object.keys(appData.otherWords).sort((a,b) => {
        return b.localeCompare(a);
    });
    
    dates.forEach(date => {
        const count = appData.otherWords[date].length;
        const card = document.createElement('div');
        card.className = 'date-card';
        card.innerHTML = `
            <div class="date-card-info" onclick="openOtherWordList('${date}')">
                <span class="date-card-icon">📅</span>
                <div>
                    <h3>${date}</h3>
                    <p>${count} Kelime</p>
                </div>
            </div>
            <button class="btn-delete-list" onclick="deleteOtherWordList('${date}', event)">Sil</button>
        `;
        container.appendChild(card);
    });
}

function deleteOtherWordList(date, event) {
    if (event) event.stopPropagation();
    
    Swal.fire({
        title: 'Emin misiniz?',
        text: `"${date}" listesi ve içindeki tüm kelimeler silinecektir!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: themes[currentLang].primary,
        cancelButtonColor: '#d33',
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'İptal'
    }).then((result) => {
        if (result.isConfirmed) {
            delete appData.otherWords[date];
            saveData().then(() => {
                renderOtherWordLists();
                alertMsg("Silindi", "Kelime listesi silindi.");
            });
        }
    });
}

let currentOtherWordListDate = "";
function openOtherWordList(date) {
    currentOtherWordListDate = date;
    showScreen('screen-other-words');
    document.getElementById('other-words-date-title').innerText = date;
    
    const list = appData.otherWords[date] || [];
    const container = document.getElementById('other-words-list');
    container.innerHTML = '';
    
    list.forEach(w => {
        const li = document.createElement('li');
        li.className = 'word-item-row';
        li.innerHTML = `
            <div class="word-main-info" onclick="showOtherWordDetail(${JSON.stringify(w).replace(/"/g, '&quot;')})">
                <span class="word-name">${w.word}</span>
                <span class="word-pron">(${w.pronunciation})</span>
                <span class="word-meaning-preview">${w.meaning}</span>
            </div>
            <button class="btn-delete-word" style="background: none; border: none; color: #e74c3c; cursor: pointer; font-size: 1.1rem; padding: 5px 10px;" onclick="deleteOtherWord('${date}', ${JSON.stringify(w).replace(/"/g, '&quot;')})">🗑️</button>
        `;
        container.appendChild(li);
    });
}

function deleteOtherWord(date, wordObj) {
    Swal.fire({
        title: 'Kelimeyi Sil?',
        text: `"${wordObj.word}" kelimesini silmek istediğinize emin misiniz?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: themes[currentLang].primary,
        cancelButtonColor: '#d33',
        confirmButtonText: 'Evet, Sil',
        cancelButtonText: 'İptal'
    }).then((result) => {
        if (result.isConfirmed) {
            if (appData.otherWords[date]) {
                appData.otherWords[date] = appData.otherWords[date].filter(x => x.word !== wordObj.word);
                saveData().then(() => {
                    openOtherWordList(date);
                    alertMsg("Silindi", "Kelime başarıyla silindi.");
                });
            }
        }
    });
}

function showOtherWordDetail(w) {
    showScreen('screen-other-word-detail');
    document.getElementById('other-detail-word-title').innerText = w.word;
    
    const typeLabel = w.type ? w.type : "Belirtilmemiş";
    
    const container = document.getElementById('other-word-detail-content');
    container.innerHTML = `
        <div class="word-detail-card" style="background: white; border-radius: 15px; padding: 25px; box-shadow: var(--shadow);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #f0f3f8; padding-bottom:15px; margin-bottom:20px;">
                <div>
                    <h2 style="font-size:2.2rem; color:var(--primary-color); margin:0;">${w.word}</h2>
                    <span style="font-size:1.1rem; color:#7f8c8d; font-style:italic;">(${w.pronunciation})</span>
                </div>
                <div style="text-align:right;">
                    <span class="word-type-tag" style="background:#e8f4fd; color:#2b6cb0; padding:6px 12px; border-radius:20px; font-weight:600; font-size:0.9rem;">${typeLabel}</span>
                </div>
            </div>
            <div style="margin-bottom:20px;">
                <strong style="display:block; color:#7f8c8d; margin-bottom:5px;">Genel Anlamı</strong>
                <p style="font-size:1.3rem; font-weight:600; color:#2d3748; margin:0;">${w.meaning}</p>
            </div>
            <div style="margin-bottom:20px; background:#f7fafc; padding:15px; border-radius:10px; border-left: 4px solid var(--primary-color);">
                <strong style="display:block; color:#7f8c8d; margin-bottom:5px;">Örnek İngilizce Cümle</strong>
                <p style="font-size:1.1rem; font-weight:500; color:#2d3748; margin:0 0 8px 0;">${w.sentenceEn}</p>
                <strong style="display:block; color:#7f8c8d; margin-bottom:5px;">Türkçe Çevirisi</strong>
                <p style="font-size:1.1rem; color:#4a5568; margin:0;">${w.sentenceTr}</p>
            </div>
            ${w.sentenceTrWithEnWord ? `
            <div style="background:#fffaf0; padding:15px; border-radius:10px; border-left: 4px solid #dd6b20;">
                <strong style="display:block; color:#7f8c8d; margin-bottom:5px;">İngilizce Kelimeli Türkçe Cümle</strong>
                <p style="font-size:1.1rem; color:#2d3748; font-weight:500; margin:0;">${w.sentenceTrWithEnWord}</p>
            </div>
            ` : ''}
            
            <div style="margin-top: 25px; text-align: center;">
                <button class="btn-primary" onclick="speakWord('${w.word.replace(/'/g, "\\'")}')" style="padding: 10px 20px; font-size: 0.95rem;">🔊 Kelimeyi Seslendir</button>
            </div>
        </div>
    `;
}

// OTHER MATCHING GAME
let otherMatchingMode = 'en-tr'; // 'en-tr' or 'tr-en'
let otherSelectedMatchLeft = null;
let otherSelectedMatchRight = null;
let otherMatchedCount = 0;

function getAllOtherWords() {
    let all = [];
    if (!appData.otherWords) return [];
    Object.keys(appData.otherWords).forEach(date => {
        all = all.concat(appData.otherWords[date]);
    });
    return all;
}

function startOtherMatchingGame(mode) {
    const allWords = getAllOtherWords();
    if (allWords.length < 5) {
        alertMsg("Yetersiz Kelime", "Eşleştirme oyunu için en az 5 kelime yüklenmiş olmalıdır.", "warning");
        return;
    }
    otherMatchingMode = mode;
    showScreen('screen-other-matching');
    
    const titleText = mode === 'en-tr' ? "Kelime Eşleştirme (İngilizce ⟶ Türkçe)" : "Kelime Eşleştirme (Türkçe ⟶ İngilizce)";
    document.getElementById('other-matching-title').innerText = titleText;
    
    restartOtherMatchingGame();
}

function restartOtherMatchingGame() {
    otherSelectedMatchLeft = null;
    otherSelectedMatchRight = null;
    otherMatchedCount = 0;
    document.getElementById('other-matching-score').innerText = `Eşleşen: 0 / 5`;
    document.getElementById('other-matching-success-message').classList.add('hidden');
    
    const allWords = getAllOtherWords();
    
    // Choose 5 random unique words
    let selected = [];
    let indices = [];
    while (selected.length < 5 && selected.length < allWords.length) {
        const idx = Math.floor(Math.random() * allWords.length);
        if (!indices.includes(idx)) {
            indices.push(idx);
            selected.push(allWords[idx]);
        }
    }
    
    // Left column: English (for en-tr) or Turkish (for tr-en)
    const leftCol = document.getElementById('other-matching-left-column');
    leftCol.innerHTML = '<h3>' + (otherMatchingMode === 'en-tr' ? 'İngilizce' : 'Türkçe') + '</h3>';
    
    const shuffledLeft = [...selected].sort(() => Math.random() - 0.5);
    shuffledLeft.forEach(item => {
        const div = document.createElement('div');
        div.className = 'matching-card';
        div.innerText = otherMatchingMode === 'en-tr' ? item.word : item.meaning;
        div.dataset.word = item.word;
        div.onclick = () => selectOtherMatchingLeftCard(div);
        leftCol.appendChild(div);
    });
    
    // Right column: Turkish (for en-tr) or English (for tr-en)
    const rightCol = document.getElementById('other-matching-right-column');
    rightCol.innerHTML = '<h3>' + (otherMatchingMode === 'en-tr' ? 'Türkçe' : 'İngilizce') + '</h3>';
    
    const shuffledRight = [...selected].sort(() => Math.random() - 0.5);
    shuffledRight.forEach(item => {
        const div = document.createElement('div');
        div.className = 'matching-card';
        div.innerText = otherMatchingMode === 'en-tr' ? item.meaning : item.word;
        div.dataset.word = item.word;
        div.onclick = () => selectOtherMatchingRightCard(div);
        rightCol.appendChild(div);
    });
}

function selectOtherMatchingLeftCard(card) {
    if (card.classList.contains('matched')) return;
    document.querySelectorAll('#other-matching-left-column .matching-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    otherSelectedMatchLeft = card;
    checkOtherMatchingPair();
}

function selectOtherMatchingRightCard(card) {
    if (card.classList.contains('matched')) return;
    document.querySelectorAll('#other-matching-right-column .matching-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    otherSelectedMatchRight = card;
    checkOtherMatchingPair();
}

function checkOtherMatchingPair() {
    if (!otherSelectedMatchLeft || !otherSelectedMatchRight) return;
    
    const leftWord = otherSelectedMatchLeft.dataset.word;
    const rightWord = otherSelectedMatchRight.dataset.word;
    
    if (leftWord === rightWord) {
        otherSelectedMatchLeft.classList.remove('selected');
        otherSelectedMatchRight.classList.remove('selected');
        otherSelectedMatchLeft.classList.add('matched');
        otherSelectedMatchRight.classList.add('matched');
        
        otherSelectedMatchLeft = null;
        otherSelectedMatchRight = null;
        otherMatchedCount++;
        
        document.getElementById('other-matching-score').innerText = `Eşleşen: ${otherMatchedCount} / 5`;
        
        if (otherMatchedCount === 5) {
            document.getElementById('other-matching-success-message').classList.remove('hidden');
        }
    } else {
        const tempLeft = otherSelectedMatchLeft;
        const tempRight = otherSelectedMatchRight;
        tempLeft.classList.add('wrong');
        tempRight.classList.add('wrong');
        
        otherSelectedMatchLeft = null;
        otherSelectedMatchRight = null;
        
        setTimeout(() => {
            tempLeft.classList.remove('selected', 'wrong');
            tempRight.classList.remove('selected', 'wrong');
        }, 600);
    }
}

// OTHER MC & SENTENCE TESTS
let otherTestType = 'mc'; 
let otherTestQuestions = [];
let otherTestCurrentIdx = 0;
let otherTestScore = 0;

function startOtherMCTest() {
    const allWords = getAllOtherWords();
    if (allWords.length < 5) {
        alertMsg("Yetersiz Kelime", "Sınav için en az 5 kelime yüklenmiş olmalıdır.", "warning");
        return;
    }
    otherTestType = 'mc';
    document.getElementById('other-test-title').innerText = "Kelime Anlam Sınavı";
    initOtherTest();
}

function startOtherSentenceTest() {
    const allWords = getAllOtherWords();
    if (allWords.length < 5) {
        alertMsg("Yetersiz Kelime", "Sınav için en az 5 kelime yüklenmiş olmalıdır.", "warning");
        return;
    }
    otherTestType = 'sentence';
    document.getElementById('other-test-title').innerText = "Kelimelerin Sorulduğu Cümle Sınavı";
    initOtherTest();
}

function initOtherTest() {
    showScreen('screen-other-test');
    document.getElementById('other-test-main-view').classList.remove('hidden');
    document.getElementById('other-test-result-view').classList.add('hidden');
    
    otherTestQuestions = [];
    otherTestCurrentIdx = 0;
    otherTestScore = 0;
    
    const allWords = getAllOtherWords();
    const shuffled = [...allWords].sort(() => Math.random() - 0.5);
    const limit = Math.min(10, shuffled.length);
    
    for (let i = 0; i < limit; i++) {
        const correct = shuffled[i];
        
        if (otherTestType === 'mc') {
            const isEnToTr = Math.random() > 0.5;
            let questionText = "";
            let correctAnswer = "";
            let choices = [];
            
            if (isEnToTr) {
                questionText = `"${correct.word}" kelimesinin Türkçe anlamı nedir?`;
                correctAnswer = correct.meaning;
                choices = generateOtherMCOptions(correct.meaning, allWords, 'meaning');
            } else {
                questionText = `Türkçe anlamı "${correct.meaning}" olan İngilizce kelime hangisidir?`;
                correctAnswer = correct.word;
                choices = generateOtherMCOptions(correct.word, allWords, 'word');
            }
            
            otherTestQuestions.push({
                type: 'mc',
                question: questionText,
                choices: choices,
                answer: correctAnswer,
                wordObj: correct
            });
        } else {
            const isEngGap = Math.random() > 0.5;
            let questionText = "";
            let correctAnswer = correct.word;
            let choices = generateOtherMCOptions(correct.word, allWords, 'word');
            
            if (isEngGap && correct.sentenceEn) {
                const regex = new RegExp('\\b' + correct.word + '\\b', 'gi');
                let gapSent = correct.sentenceEn.replace(regex, "_______");
                
                if (!gapSent.includes("_______")) {
                    gapSent = correct.sentenceEn.replace(new RegExp(correct.word.substring(0,4) + '[a-z]*', 'gi'), "_______");
                }
                
                questionText = `Cümledeki boşluğa hangi kelime gelmelidir?<br><br><strong>${gapSent}</strong><br><small>(${correct.sentenceTr})</small>`;
            } else if (correct.sentenceTrWithEnWord) {
                const regex = new RegExp('\\b' + correct.word + '\\b', 'gi');
                let gapSent = correct.sentenceTrWithEnWord.replace(regex, "_______");
                if (!gapSent.includes("_______")) {
                    gapSent = correct.sentenceTrWithEnWord.replace(new RegExp(correct.word.substring(0,4) + "[a-z']*", 'gi'), "_______");
                }
                
                questionText = `Türkçe cümledeki boşluğa uygun İngilizce kelimeyi yerleştirin:<br><br><strong>${gapSent}</strong>`;
            } else {
                questionText = `"${correct.word} (${correct.pronunciation})" kelimesi aşağıdaki hangi cümlede doğru şekilde kullanılmıştır?<br><br>Cevap şıklarından seçiniz.`;
            }
            
            otherTestQuestions.push({
                type: 'sentence',
                question: questionText,
                choices: choices,
                answer: correctAnswer,
                wordObj: correct
            });
        }
    }
    
    renderOtherTestQuestion();
}

function generateOtherMCOptions(correctVal, allWords, key) {
    let choices = [correctVal];
    let attempts = 0;
    while (choices.length < 4 && attempts < 100) {
        attempts++;
        const randWord = allWords[Math.floor(Math.random() * allWords.length)];
        const val = randWord[key];
        if (val && !choices.includes(val)) {
            choices.push(val);
        }
    }
    while (choices.length < 4) {
        choices.push("Seçenek " + (choices.length + 1));
    }
    return choices.sort(() => Math.random() - 0.5);
}

function renderOtherTestQuestion() {
    document.getElementById('other-test-progress').innerText = `${otherTestCurrentIdx + 1} / ${otherTestQuestions.length}`;
    document.getElementById('btn-next-other-question').style.display = 'none';
    document.getElementById('other-test-feedback').classList.add('hidden');
    
    const q = otherTestQuestions[otherTestCurrentIdx];
    const container = document.getElementById('other-test-question-container');
    container.innerHTML = '';
    
    const qText = document.createElement('h3');
    qText.style.marginBottom = '25px';
    qText.style.fontSize = '1.3rem';
    qText.style.lineHeight = '1.5';
    qText.innerHTML = q.question;
    container.appendChild(qText);
    
    const grid = document.createElement('div');
    grid.className = 'choices-grid';
    
    q.choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerText = choice;
        btn.onclick = () => selectOtherTestOption(choice, btn);
        grid.appendChild(btn);
    });
    
    container.appendChild(grid);
}

function selectOtherTestOption(selectedVal, element) {
    const q = otherTestQuestions[otherTestCurrentIdx];
    
    document.querySelectorAll('#other-test-question-container .choice-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.innerText === q.answer) {
            btn.classList.add('correct');
        }
    });
    
    if (selectedVal === q.answer) {
        element.classList.add('correct');
        otherTestScore++;
    } else {
        element.classList.add('wrong');
    }
    
    const feedbackText = document.getElementById('other-test-feedback-text');
    feedbackText.innerHTML = `
        <strong>Kelime:</strong> ${q.wordObj.word} (${q.wordObj.pronunciation})<br>
        <strong>Anlamı:</strong> ${q.wordObj.meaning} (${q.wordObj.type ? q.wordObj.type : 'Belirtilmemiş'})<br>
        <strong>Cümle:</strong> ${q.wordObj.sentenceEn}<br>
        <strong>Çeviri:</strong> ${q.wordObj.sentenceTr}
    `;
    document.getElementById('other-test-feedback').classList.remove('hidden');
    
    document.getElementById('btn-next-other-question').style.display = 'inline-block';
}

function nextOtherQuestion() {
    otherTestCurrentIdx++;
    if (otherTestCurrentIdx < otherTestQuestions.length) {
        renderOtherTestQuestion();
    } else {
        document.getElementById('other-test-main-view').classList.add('hidden');
        document.getElementById('other-test-result-view').classList.remove('hidden');
        document.getElementById('other-test-score-text').innerText = `${otherTestQuestions.length} sorudan ${otherTestScore} doğru, ${otherTestQuestions.length - otherTestScore} yanlış yaptınız.`;
    }
}

function confirmEndOtherTest() {
    Swal.fire({
        title: 'Testi Bitir?',
        text: 'Devam etmekte olan testiniz sonlandırılacaktır. Emin misiniz?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: themes[currentLang].primary,
        cancelButtonColor: '#d33',
        confirmButtonText: 'Evet, Bitir',
        cancelButtonText: 'İptal'
    }).then((result) => {
        if (result.isConfirmed) {
            showOtherWorkspace();
        }
    });
}

// --- RICH TEXT EDITOR & BULUT SENKRONİZASYONU ---
function formatDoc(cmd, value = null) {
    document.execCommand(cmd, false, value);
}

async function forceAppUpdate() {
    showLoading("Önbellek temizleniyor ve güncelleniyor...");
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) {
                await registration.unregister();
            }
        }
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            for (let cacheName of cacheNames) {
                await caches.delete(cacheName);
            }
        }
        hideLoading();
        Swal.fire({
            title: "Güncellendi!",
            text: "Uygulama başarıyla güncellendi ve önbellek temizlendi. Sayfa yeniden yükleniyor...",
            icon: "success"
        }).then(() => {
            window.location.reload(true);
        });
    } catch (e) {
        console.error(e);
        hideLoading();
        window.location.reload(true);
    }
}

async function generateSyncKey() {
    showLoading("Yeni senkronizasyon anahtarı alınıyor...");
    try {
        const response = await fetch("https://kvdb.io/", { method: "POST", body: "email=sync@vocabularyapp.com" });
        if (response.status === 200 || response.status === 201) {
            const bucketId = (await response.text()).trim();
            document.getElementById('sync-key-input').value = bucketId;
            localStorage.setItem('sync_key', bucketId);
            hideLoading();
            Swal.fire({
                title: "Anahtar Alındı!",
                text: `Yeni anahtarınız: ${bucketId}. Diğer cihazlarınızda eşitleme yapmak için bu anahtarı kullanın.`,
                icon: "success"
            });
        } else {
            throw new Error("Bucket creation failed with status " + response.status);
        }
    } catch(e) {
        console.error(e);
        const randKey = "sync_" + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);
        document.getElementById('sync-key-input').value = randKey;
        localStorage.setItem('sync_key', randKey);
        hideLoading();
        Swal.fire({
            title: "Anahtar Oluşturuldu (Yerel Üretim)!",
            text: `Üretilen anahtar: ${randKey}. Diğer cihazlarınızda eşitleme yapmak için bu anahtarı kullanın.`,
            icon: "success"
        });
    }
}

async function syncWithCloud(silent = false) {
    const syncKeyInput = document.getElementById('sync-key-input');
    const syncKey = syncKeyInput ? syncKeyInput.value.trim() : localStorage.getItem('sync_key');
    if (!syncKey) {
        if (!silent) alertMsg("Hata", "Lütfen önce bir senkronizasyon anahtarı girin.", "warning");
        return;
    }
    
    localStorage.setItem('sync_key', syncKey);
    if (syncKeyInput) syncKeyInput.value = syncKey;
    
    if (!silent) showLoading("Bulutla eşitleniyor...");
    
    try {
        const url = `https://kvdb.io/${syncKey}/appData_${currentLang}`;
        const response = await fetch(url);
        
        let cloudData = null;
        if (response.status === 200) {
            const text = await response.text();
            try {
                cloudData = JSON.parse(text);
            } catch(e) {
                console.error("Cloud data is not valid JSON", e);
            }
        }
        
        if (cloudData) {
            mergeAppData(cloudData);
        }
        
        const uploadResponse = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appData)
        });
        
        if (uploadResponse.status === 200 || uploadResponse.status === 201) {
            await saveData();
            if (!silent) {
                hideLoading();
                Swal.fire({
                    title: "Başarılı!",
                    text: "Veriler bulutla başarıyla eşitlendi ve güncellendi.",
                    icon: "success"
                }).then(() => {
                    if (document.getElementById('screen-word-dates').classList.contains('active')) showWordLists();
                    if (document.getElementById('screen-other-word-dates').classList.contains('active')) showOtherWordLists();
                    if (document.getElementById('screen-grammar-list').classList.contains('active')) showGrammarSection();
                });
            }
        } else {
            throw new Error("Cloud upload failed with status " + uploadResponse.status);
        }
    } catch (e) {
        console.error("Sync error:", e);
        if (!silent) {
            hideLoading();
            alertMsg("Hata", "Bulut senkronizasyonu sırasında bir hata oluştu: " + e.message, "error");
        }
    }
}

function toggleAutoSync() {
    const checkbox = document.getElementById('sync-auto-checkbox');
    localStorage.setItem('sync_auto', checkbox.checked ? "true" : "false");
    if (checkbox.checked) {
        syncWithCloud(true);
    }
}

function mergeAppData(cloudData) {
    if (!cloudData) return;
    
    if (cloudData.words) {
        for (let date in cloudData.words) {
            if (!appData.words[date]) {
                appData.words[date] = cloudData.words[date];
            } else {
                const localList = appData.words[date];
                const cloudList = cloudData.words[date];
                cloudList.forEach(cw => {
                    if (!localList.some(lw => lw.word.toLowerCase() === cw.word.toLowerCase())) {
                        localList.push(cw);
                    }
                });
            }
        }
    }
    
    if (cloudData.otherWords) {
        if (!appData.otherWords) appData.otherWords = {};
        for (let date in cloudData.otherWords) {
            if (!appData.otherWords[date]) {
                appData.otherWords[date] = cloudData.otherWords[date];
            } else {
                const localList = appData.otherWords[date];
                const cloudList = cloudData.otherWords[date];
                cloudList.forEach(cw => {
                    if (!localList.some(lw => lw.word.toLowerCase() === cw.word.toLowerCase())) {
                        localList.push(cw);
                    }
                });
            }
        }
    }
    
    if (cloudData.grammar) {
        if (!appData.grammar) appData.grammar = [];
        cloudData.grammar.forEach(cg => {
            if (!appData.grammar.some(lg => lg.id === cg.id)) {
                appData.grammar.push(cg);
            }
        });
    }
    
    if (cloudData.tests) {
        if (!appData.tests) appData.tests = [];
        cloudData.tests.forEach(ct => {
            if (!appData.tests.some(lt => lt.title === ct.title)) {
                appData.tests.push(ct);
            }
        });
    }
    
    if (cloudData.flashcards) {
        if (!appData.flashcards) appData.flashcards = {};
        for (let name in cloudData.flashcards) {
            if (!appData.flashcards[name]) {
                appData.flashcards[name] = cloudData.flashcards[name];
            }
        }
    }
    
    if (cloudData.stats) {
        if (!appData.stats) appData.stats = { correct: 0, wrong: 0 };
        appData.stats.correct = Math.max(appData.stats.correct, cloudData.stats.correct);
        appData.stats.wrong = Math.max(appData.stats.wrong, cloudData.stats.wrong);
    }
    
    if (cloudData.wrongWords) {
        if (!appData.wrongWords) appData.wrongWords = {};
        for (let date in cloudData.wrongWords) {
            if (!appData.wrongWords[date]) {
                appData.wrongWords[date] = cloudData.wrongWords[date];
            } else {
                const localList = appData.wrongWords[date];
                const cloudList = cloudData.wrongWords[date];
                cloudList.forEach(cw => {
                    if (!localList.some(lw => lw.word === cw.word)) {
                        localList.push(cw);
                    }
                });
            }
        }
    }
}

// --- DYNAMIC FLOATING TOOLBAR IMPLEMENTATION ---
function initFloatingEditorToolbar() {
    if (document.getElementById('floating-editor-toolbar')) return;
    
    const toolbar = document.createElement('div');
    toolbar.id = 'floating-editor-toolbar';
    toolbar.style.cssText = `
        position: absolute;
        background: #2d3748;
        border-radius: 8px;
        padding: 6px 10px;
        display: none;
        gap: 8px;
        align-items: center;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -2px rgba(0,0,0,0.2);
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.15s ease-in-out;
        border: 1px solid #4a5568;
    `;
    
    toolbar.innerHTML = `
        <button onclick="formatDoc('justifyLeft')" type="button" style="padding: 4px 8px; border-radius: 4px; border: none; background: #4a5568; color: white; cursor: pointer; font-size: 0.8rem; font-weight: bold;">⬅️ Sola</button>
        <button onclick="formatDoc('justifyCenter')" type="button" style="padding: 4px 8px; border-radius: 4px; border: none; background: #4a5568; color: white; cursor: pointer; font-size: 0.8rem; font-weight: bold;">↔️ Ortala</button>
        <button onclick="formatDoc('justifyFull')" type="button" style="padding: 4px 8px; border-radius: 4px; border: none; background: #4a5568; color: white; cursor: pointer; font-size: 0.8rem; font-weight: bold;">↔️ İki Yana</button>
        
        <div style="width: 1px; height: 18px; background: #4a5568;"></div>
        
        <span style="font-size: 0.75rem; color: #cbd5e0; font-weight: bold;">Fon:</span>
        <button onclick="formatDoc('backColor', 'white')" type="button" style="width: 18px; height: 18px; border-radius: 3px; border: 1px solid #718096; background: white; cursor: pointer; padding: 0;"></button>
        <button onclick="formatDoc('backColor', '#ffccd5')" type="button" style="width: 18px; height: 18px; border-radius: 3px; border: 1px solid #718096; background: #ffccd5; cursor: pointer; padding: 0;"></button>
        <button onclick="formatDoc('backColor', '#fff3cd')" type="button" style="width: 18px; height: 18px; border-radius: 3px; border: 1px solid #718096; background: #fff3cd; cursor: pointer; padding: 0;"></button>
        <button onclick="formatDoc('backColor', '#d4edda')" type="button" style="width: 18px; height: 18px; border-radius: 3px; border: 1px solid #718096; background: #d4edda; cursor: pointer; padding: 0;"></button>
        <button onclick="formatDoc('backColor', '#d1ecf1')" type="button" style="width: 18px; height: 18px; border-radius: 3px; border: 1px solid #718096; background: #d1ecf1; cursor: pointer; padding: 0;"></button>
        <button onclick="formatDoc('backColor', 'transparent')" type="button" style="padding: 3px 6px; font-size: 0.7rem; border-radius: 3px; border: none; background: #e53e3e; color: white; cursor: pointer;">Sil</button>
    `;
    
    document.body.appendChild(toolbar);
    
    // Selection listener
    document.addEventListener('selectionchange', handleTextSelection);
}

function handleTextSelection() {
    const editor = document.getElementById('edit-note-content-input');
    const toolbar = document.getElementById('floating-editor-toolbar');
    if (!editor || !toolbar) return;
    
    // Check if the edit mode is active
    const editModeContainer = document.getElementById('grammar-edit-mode');
    const editModeActive = editModeContainer && !editModeContainer.classList.contains('hidden');
    if (!editModeActive) {
        toolbar.style.display = 'none';
        toolbar.style.opacity = '0';
        return;
    }
    
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) {
        toolbar.style.display = 'none';
        toolbar.style.opacity = '0';
        return;
    }
    
    const range = selection.getRangeAt(0);
    // Make sure selection is inside the contenteditable editor
    if (!editor.contains(range.commonAncestorContainer)) {
        toolbar.style.display = 'none';
        toolbar.style.opacity = '0';
        return;
    }
    
    const rect = range.getBoundingClientRect();
    toolbar.style.display = 'flex';
    
    const toolbarHeight = toolbar.offsetHeight || 38;
    const toolbarWidth = toolbar.offsetWidth || 320;
    
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    let top = rect.top + scrollTop - toolbarHeight - 10;
    let left = rect.left + scrollLeft + (rect.width / 2) - (toolbarWidth / 2);
    
    if (left < 10) left = 10;
    if (left + toolbarWidth > window.innerWidth - 10) {
        left = window.innerWidth - toolbarWidth - 10;
    }
    if (rect.top - toolbarHeight - 10 < 10) {
        top = rect.bottom + scrollTop + 10;
    }
    
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
    setTimeout(() => {
        toolbar.style.opacity = '1';
    }, 10);
}

// Keyboard listener for Ctrl+S inside grammar edit mode
document.addEventListener('keydown', function(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        const editModeContainer = document.getElementById('grammar-edit-mode');
        const editModeActive = editModeContainer && !editModeContainer.classList.contains('hidden');
        if (editModeActive) {
            event.preventDefault();
            saveGrammarEdit();
        }
    }
});

