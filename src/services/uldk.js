const axios = require('axios');

async function znajdzTERYT(nazwa) {
    try {
        console.log(`🔎 Szukam kodu TERYT dla: "${nazwa}"...\n`);
        
        const url = 'https://uldk.gugik.gov.pl/';
        const params = {
            request: 'GetRegionByNameOrId', // Szukamy obrębu po nazwie
            id: nazwa,                      // Wpisana nazwa miasta/gminy
            result: 'teryt,commune,county,voivodeship' // Żądamy kodu TERYT oraz nazw z podziału adm.
        };

        const response = await axios.get(url, { params });
        const lines = response.data.trim().split('\n');

        // API ULDK w pierwszej linii zawsze zwraca kod statusu (0 - znaleziono)
        const status = lines[0];
        if (status !== '0') {
            console.log(`❌ Nie znaleziono miejscowości/gminy o nazwie: ${nazwa}`);
            return;
        }

        // Używamy Map, aby odfiltrować duplikaty (bo miasto może składać się z kilkudziesięciu obrębów)
        const znalezioneGminy = new Map();

        // Iterujemy od 2. linii (pomijamy kod statusu)
        for (let i = 1; i < lines.length; i++) {
            const wiersz = lines[i].split('|');
            if (wiersz.length < 4) continue;

            const [terytObrebu, gmina, powiat, wojewodztwo] = wiersz;

            // Odcinamy wszystko po kropce, aby uzyskać sam kod TERYT gminy!
            // np. "146501_1.0001" staje się "146501_1"
            const kodTerytGminy = terytObrebu.split('.')[0];

            if (!znalezioneGminy.has(kodTerytGminy)) {
                znalezioneGminy.set(kodTerytGminy, {
                    teryt: kodTerytGminy,
                    gmina,
                    powiat,
                    wojewodztwo
                });
            }
        }

        // Wyświetlanie wyników
        console.log(`✅ Znaleziono pasujące jednostki administracyjne (${znalezioneGminy.size}):\n`);
        
        znalezioneGminy.forEach(wynik => {
            console.log(`📌 Kod TERYT: \x1b[32m${wynik.teryt}\x1b[0m`);
            console.log(`   Gmina: ${wynik.gmina}`);
            console.log(`   Powiat: ${wynik.powiat}`);
            console.log(`   Województwo: ${wynik.wojewodztwo}`);
            console.log('-----------------------------------');
        });

    } catch (error) {
        console.error('❌ Wystąpił błąd podczas komunikacji z API GUGiK:', error.message);
    }
}

// Pobieramy nazwę z argumentu wiersza poleceń, a w przypadku braku podajemy wartość domyślną
const nazwaDoSzukania = process.argv[2] || 'Białystok';
znajdzTERYT(nazwaDoSzukania);