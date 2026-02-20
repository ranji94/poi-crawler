const axios = require('axios');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'courtsdata', 'courts_cache.json');
const DIVISIONS_FILE = path.join(__dirname, 'courtsdata', 'divisions.json');

// --- 1. Komunikacja z API ULDK ---
async function getCommuneNameByTeryt(teryt) {
    try {
        const sformatowanyTeryt = teryt.replace(/^(\d{6})(\d)$/, '$1_$2');
        console.error(`🔎 Dekodowanie kodu TERYT (${sformatowanyTeryt}) w GUGiK...`);
        
        const url = 'https://uldk.gugik.gov.pl/';
        const params = {
            request: 'GetCommuneById',
            id: sformatowanyTeryt,
            result: 'commune,region,county'
        };

        const response = await axios.get(url, { params });
        const lines = response.data.trim().split('\n');

        console.log(`Dane o gminie: ${JSON.stringify(lines)}`)

        if (lines[0] !== '0') {
            console.error(`❌ Nie znaleziono gminy dla kodu TERYT: ${sformatowanyTeryt}`);
            return null;
        }

        const nazwaGminy = lines[1].trim();
        console.error(`✅ Rozpoznano jednostkę: ${nazwaGminy}`);
        return nazwaGminy;

    } catch (error) {
        console.error('❌ Błąd podczas komunikacji z ULDK:', error.message);
        return null;
    }
}

// --- 2. Pobieranie i parsowanie właściwości z dane.gov.pl ---
async function pobierzIWyczyscSady() {
    try {
        console.error('📥 Pobieranie aktualnego wykazu z dane.gov.pl...');
        const apiUrl = 'https://api.dane.gov.pl/1.4/datasets/985/resources';
        const response = await axios.get(apiUrl);
        const plik = response.data.data.find(r => 
            r.attributes.title.toLowerCase().includes('właściwość') && 
            (r.attributes.format === 'xls' || r.attributes.format === 'xlsx')
        );

        if (!plik) throw new Error('Nie znaleziono pliku Excel w API MS.');

        const fileResponse = await axios.get(plik.attributes.file_url, { responseType: 'arraybuffer' });
        const workbook = xlsx.read(fileResponse.data, { type: 'buffer' });
        const dataJson = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        const wyczyszczoneDane = sanitizeSady(dataJson);
        
        fs.writeFileSync(CACHE_FILE, JSON.stringify(wyczyszczoneDane, null, 2), 'utf8');
        console.error(`💾 Zapisano świeże dane do lokalnego pliku cache.`);
        
        return wyczyszczoneDane;
    } catch (error) {
        console.error('❌ Błąd pobierania sądów:', error.message);
        return [];
    }
}

// --- 3. Mechanizm Cache'owania ---
async function getSadyData() {
    const teraz = new Date();
    const jestPierwszyTydzien = teraz.getDate() <= 7;
    const aktualnyMiesiacRok = `${teraz.getFullYear()}-${teraz.getMonth()}`;

    if (fs.existsSync(CACHE_FILE)) {
        const stats = fs.statSync(CACHE_FILE);
        const dataModyfikacji = new Date(stats.mtime);
        const modyfikacjaMiesiacRok = `${dataModyfikacji.getFullYear()}-${dataModyfikacji.getMonth()}`;

        if (modyfikacjaMiesiacRok === aktualnyMiesiacRok) {
            console.error('⚡ Używam lokalnego, aktualnego pliku cache (sady_cache.json)');
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }

        if (jestPierwszyTydzien && modyfikacjaMiesiacRok !== aktualnyMiesiacRok) {
            console.error('🔄 Nowy miesiąc. Aktualizuję bazę sądów...');
            return await pobierzIWyczyscSady();
        }
        
        if (modyfikacjaMiesiacRok !== aktualnyMiesiacRok) {
             console.error('🔄 Plik cache jest przestarzały. Aktualizuję...');
             return await pobierzIWyczyscSady();
        }
    }

    console.error('🔄 Brak lokalnego pliku cache. Buduję bazę od zera...');
    return await pobierzIWyczyscSady();
}

// --- 4. Sanitizer ---
function sanitizeSady(rawData) {
    let currentApelacyjny = null;
    let currentOkregowy = null;
    const result = [];
  
    rawData.forEach(row => {
      if (row['__EMPTY'] && row['__EMPTY'].includes('Sąd Apelacyjny')) currentApelacyjny = row['__EMPTY'].trim();
      if (row['__EMPTY_1'] && row['__EMPTY_1'].includes('Sąd Okręgowy')) currentOkregowy = row['__EMPTY_1'].trim();
  
      const rejonowy = row['__EMPTY_2'];
      const wlasciwosc = row['__EMPTY_3'];
  
      if (rejonowy && rejonowy.includes('Sąd Rejonowy') && wlasciwosc) {
        const txt = wlasciwosc.trim();
        let miasta = [], gminy = [], dzielnice = null;
  
        const splitAndClean = (str) => {
          if (!str) return [];
          return str.split(/,| i /).map(s => s.trim().replace(/^i /, '').replace(/^oraz /, '').replace(/^a także /, '')).filter(s => s.length > 0);
        };
  
        if (txt.includes('dla części miasta')) {
          const parts = txt.split(/a także dla gmin:|oraz gmin:|oraz gminy:/);
          dzielnice = parts[0].trim();
          if (parts[1]) gminy = splitAndClean(parts[1]);
        } else {
          const miastaMatch = txt.match(/dla miast[a]? (.*?)(?: oraz| a także|$)/);
          if (miastaMatch && !miastaMatch[1].includes('gmin')) miasta = splitAndClean(miastaMatch[1]);
  
          const gminyMatch = txt.match(/gminy?: (.*)/);
          if (gminyMatch) gminy = splitAndClean(gminyMatch[1]);
          else if (txt.includes('dla gmin:')) gminy = splitAndClean(txt.split('dla gmin:')[1]);
          else if (txt.includes('oraz gmin:')) gminy = splitAndClean(txt.split('oraz gmin:')[1]);
        }
  
        result.push({
          sad_apelacyjny: currentApelacyjny,
          sad_okregowy: currentOkregowy,
          sad_rejonowy: rejonowy.trim(),
          obszar_wlasciwosci: { miasta: miasta.length > 0 ? miasta : null, gminy: gminy.length > 0 ? gminy : null, dzielnice_ulice: dzielnice, surowy_tekst: txt }
        });
      }
    });
    return result;
}

// --- 5. Funkcja pomocnicza: Pobieranie wydziałów z divisions.json ---
function znajdzWydzialy(nazwaSadu, divisionsData) {
    if (!nazwaSadu || !divisionsData) return null;

    // Jeżeli divisions.json to obiekt typu { "Sąd Rejonowy...": [...] }
    if (!Array.isArray(divisionsData) && typeof divisionsData === 'object') {
        return divisionsData[nazwaSadu] || null;
    }

    // Jeżeli divisions.json to tablica obiektów np. [{ "name": "Sąd...", "wydzialy": [...] }]
    if (Array.isArray(divisionsData)) {
        const znaleziony = divisionsData.find(item => {
            const kluczNazwy = item.name || item.nazwa || item.sad || item.court;
            return kluczNazwy && kluczNazwy.toLowerCase() === nazwaSadu.toLowerCase();
        });
        
        if (znaleziony) {
            return znaleziony.wydzialy || znaleziony.divisions || znaleziony.departments || znaleziony;
        }
    }
    
    return null;
}

// --- GŁÓWNA LOGIKA PROGRAMU ---
async function szukajSaduDlaTeryt(kodTeryt) {
    const nazwaGminy = await getCommuneNameByTeryt(kodTeryt);
    if (!nazwaGminy) {
        // Zwracamy pusty JSON jeśli błąd
        console.log(JSON.stringify({ error: "Nie znaleziono gminy dla podanego kodu TERYT" }, null, 2));
        return;
    }

    const sady = await getSadyData();
    
    // Pobranie danych o wydziałach (jeśli plik istnieje)
    let divisionsData = null;
    if (fs.existsSync(DIVISIONS_FILE)) {
        try {
            divisionsData = JSON.parse(fs.readFileSync(DIVISIONS_FILE, 'utf8'));
        } catch (e) {
            console.error(`❌ Błąd parsowania pliku ${DIVISIONS_FILE}:`, e.message);
        }
    } else {
        console.error(`⚠️ Nie znaleziono pliku z wydziałami w lokalizacji: ${DIVISIONS_FILE}`);
    }

    const znalezioneSady = sady.filter(sad => {
        const obszar = sad.obszar_wlasciwosci;
        const wMiastach = obszar.miasta && obszar.miasta.includes(nazwaGminy);
        const wGminach = obszar.gminy && obszar.gminy.includes(nazwaGminy);
        const wielkieMiasto = obszar.surowy_tekst.includes(nazwaGminy) && obszar.dzielnice_ulice;

        return wMiastach || wGminach || wielkieMiasto;
    });

    // Budujemy ostateczny wynik do formatu JSON
    const finalOutput = {
        teryt: kodTeryt,
        gmina: nazwaGminy,
        znalezione_sady: znalezioneSady.map(sad => ({
            sad_rejonowy: sad.sad_rejonowy,
            wydzialy_rejonowe: znajdzWydzialy(sad.sad_rejonowy, divisionsData),
            sad_okregowy: sad.sad_okregowy,
            wydzialy_okregowe: znajdzWydzialy(sad.sad_okregowy, divisionsData),
            sad_apelacyjny: sad.sad_apelacyjny,
            uwagi: sad.obszar_wlasciwosci.dzielnice_ulice || null
        }))
    };

    // WYPLUCIE CZYSTEGO JSONA DO KONSOLI
    console.log(JSON.stringify(finalOutput, null, 2));
}

const terytWejsciowy = process.argv[2] || '0410014';
szukajSaduDlaTeryt(terytWejsciowy);