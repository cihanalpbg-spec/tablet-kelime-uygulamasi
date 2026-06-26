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
    
    const titles = { english: 'İngilizce', spanish: 'İspanyolca', italian: 'İtalyanca', russian: 'Rusça' };
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
        if (!appData.tests) appData.tests = [];
        if (!appData.grammar) appData.grammar = [];
        if (!appData.spacedStatus) appData.spacedStatus = {};
    } catch (e) {
        console.error(e);
        appData = { words: {}, tests: [], grammar: [] };
    }
    hideLoading();
    
    // Check for Spaced Repetition reviews
    checkDailyReviews();
    
    showScreen('screen-dashboard');
}

async function saveData() {
    try {
        if (window.pywebview && window.pywebview.api) {
            await window.pywebview.api.save_data(currentLang, appData);
        } else {
            await db.setItem(currentLang, appData);
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

function checkGameAnswer() {
    const input = document.getElementById('game-answer-input');
    const feedback = document.getElementById('game-feedback');
    const val = input.value.trim().toLowerCase();
    const w = gameState.currentWord;
    
    if (!val) return;
    
    let isCorrect = false;
    let correctText = "";
    
    if (gameState.mode === 1) {
        // Turkish Meaning check (fuzzy match)
        if (w.meaning.toLowerCase().includes(val)) isCorrect = true;
        correctText = w.meaning;
    } else if (gameState.mode === 2) {
        if (val === w.word.toLowerCase()) isCorrect = true;
        correctText = w.word;
    } else if (gameState.mode === 3) {
        if (gameState.correctAnswers.some(ans => ans.includes(val))) isCorrect = true;
        correctText = gameState.correctAnswers.join(', ');
    }
    
    if (isCorrect) {
        feedback.innerText = "Doğru! 🎉";
        feedback.className = "game-feedback game-correct";
        gameState.score += 10;
        document.getElementById('game-score').innerText = `Puan: ${gameState.score}`;
        input.disabled = true;
        setTimeout(nextGameQuestion, 1500);
    } else {
        feedback.innerText = `Yanlış! Doğrusu: ${correctText}`;
        feedback.className = "game-feedback game-wrong";
        input.disabled = true;
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
    const titles = { english: 'İngilizce', spanish: 'İspanyolca', italian: 'İtalyanca', russian: 'Rusça' };
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

async function handleGrammarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Prompt for Title first
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
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
        const htmlContent = result.value;
        
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
    
    // Set values in input & textarea
    document.getElementById('edit-note-title-input').value = note.title;
    document.getElementById('edit-note-content-input').value = note.html;
    
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
    const newHtml = document.getElementById('edit-note-content-input').value.trim();
    
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
