import { Elysia } from 'elysia';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = 3000;
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Configuration des hébergeurs à détecter
const HOST_CONFIG: Record<string, { regex: RegExp, template: (id: string) => string }> = {
    vidmoly: {
        regex: /vidmoly\.[a-z0-9]+\/(?:embed-|w\/)?([a-zA-Z0-9]+)/gi,
        template: (id) => `https://vidmoly.biz/embed-${id}.html`
    },
    sibnet: {
        regex: /video\.sibnet\.ru\/shell\.php\?videoid=([0-9]+)/gi,
        template: (id) => `https://video.sibnet.ru/shell.php?videoid=${id}`
    },
    oneupload: {
        regex: /oneupload\.to\/(?:embed-)?([a-zA-Z0-9]+)/gi,
        template: (id) => `https://oneupload.to/embed-${id}.html`
    },
    sendvid: {
        regex: /sendvid\.com\/(?:embed\/)?([a-zA-Z0-9]+)/gi,
        template: (id) => `https://sendvid.com/embed/${id}`
    },
    smoothpre: {
        regex: /Smoothpre\.com\/embed\/([a-zA-Z0-9]+)/gi,
        template: (id) => `https://smoothpre.com/embed/${id}`
    }
};

function extractIdFromAnilist(url: string): string | null {
    const match = url.match(/anime\/(\d+)/);
    return match ? match[1] : null;
}

/**
 * Génère le fichier meta.json : langs[lang] = [providers]
 * Chaque langue a sa propre liste de providers (fichiers .txt ou .enc dans le dossier lang).
 */
async function generateMeta(anilistId: string) {
    const animeDir = join('index', anilistId);
    try {
        const entries = await readdir(animeDir, { withFileTypes: true });
        const langDirs = entries
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .filter(name => !name.startsWith('.'))
            .sort();

        const langs: Record<string, string[]> = {};
        for (const lang of langDirs) {
            const langDir = join(animeDir, lang);
            const files = await readdir(langDir);
            const providers = files
                .filter(f => f.endsWith('.txt') || f.endsWith('.enc'))
                .map(f => f.replace(/\.(txt|enc)$/, ''))
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort();
            if (providers.length > 0) {
                langs[lang] = providers;
            }
        }

        if (Object.keys(langs).length > 0) {
            const metaData = { langs };
            await Bun.write(join(animeDir, 'meta.json'), JSON.stringify(metaData, null, 4));
        }
    } catch (e) {
        console.error(`Erreur meta.json [${anilistId}]:`, e);
    }
}

new Elysia()
    .get('/', () => Bun.file(join(import.meta.dir, 'public/index.html')))
    .post('/extract', async ({ body }: any) => {
        const asLines = body.asUrls.split('\n').map((u: string) => u.trim()).filter(Boolean);
        const aniLines = body.aniUrls.split('\n').map((u: string) => u.trim()).filter(Boolean);
        
        if (asLines.length !== aniLines.length) {
            return { log: "❌ Erreur : Les deux listes doivent avoir le même nombre de lignes." };
        }

        let globalLog = "";
        const updatedIds = new Set<string>();

        for (let i = 0; i < asLines.length; i++) {
            const baseUrl = asLines[i].endsWith('/') ? asLines[i] : asLines[i] + '/';
            const anilistId = extractIdFromAnilist(aniLines[i]);

            if (!anilistId) continue;

            for (const type of ['vostfr', 'vf']) {
                try {
                    const jsUrl = `${baseUrl}${type}/episodes.js`;
                    const res = await fetch(jsUrl, { headers: { ...BASE_HEADERS, 'Referer': baseUrl } });
                    
                    if (!res.ok) continue;

                    const text = await res.text();
                    const folderName = (type === 'vostfr') ? 'vo' : 'vf';
                    const saveDir = join('index', anilistId, folderName);
                    
                    await mkdir(saveDir, { recursive: true });

                    let foundForThisLang = false;

                    for (const [hostName, config] of Object.entries(HOST_CONFIG)) {
                        const matches = [...text.matchAll(config.regex)];
                        
                        if (matches.length > 0) {
                            const links = [...new Set(matches.map(m => config.template(m[1])))];
                            await Bun.write(join(saveDir, `${hostName}.txt`), links.join('\n'));
                            
                            globalLog += `✅ [${anilistId}] ${hostName} (${folderName}) ajouté.\n`;
                            foundForThisLang = true;
                        }
                    }

                    if (foundForThisLang) updatedIds.add(anilistId);

                } catch (e) {
                    globalLog += `⚠️ Erreur lors de la récupération : ${anilistId} (${type})\n`;
                }
            }
        }

        // Mise à jour finale des fichiers meta.json
        for (const id of updatedIds) {
            await generateMeta(id);
            globalLog += `📄 [${id}] meta.json mis à jour.\n`;
        }
        
        return { log: globalLog || "Aucune donnée trouvée." };
    })
    .listen(PORT);

console.log(`🟢 Mass Extractor opérationnel sur http://localhost:${PORT}`);