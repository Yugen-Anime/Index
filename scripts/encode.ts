import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { createCipheriv, randomBytes } from 'crypto';

// Charger le fichier .env depuis le dossier scripts
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
}

const KEY = process.env.KEY;

if (!KEY) {
  console.error('❌ La clé KEY n\'est pas définie dans le fichier .env');
  process.exit(1);
}

// Décoder la clé base64
let keyBuffer: Buffer;
try {
  keyBuffer = Buffer.from(KEY, 'base64');
  if (keyBuffer.length !== 32) {
    console.error('❌ La clé doit faire 32 bytes (256 bits) après décodage base64');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Erreur lors du décodage de la clé base64:', error);
  process.exit(1);
}

// Fonction pour chiffrer une ligne
function encryptLine(line: string): string {
  // Générer un IV de 12 bytes (unique par ligne)
  const iv = randomBytes(12);
  
  // Créer le cipher en mode GCM
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  
  // Chiffrer la ligne
  let encrypted = cipher.update(line, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  // Récupérer le tag d'authentification (16 bytes)
  const tag = cipher.getAuthTag();
  
  // Encoder en base64
  const iv_b64 = iv.toString('base64');
  const tag_b64 = tag.toString('base64');
  const cipher_b64 = encrypted.toString('base64');
  
  // Format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
  return `v1:${iv_b64}:${tag_b64}:${cipher_b64}`;
}

// Fonction récursive pour trouver tous les fichiers .txt
function findTxtFiles(dir: string): string[] {
  const files: string[] = [];
  
  try {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Récursivement chercher dans les sous-dossiers
        files.push(...findTxtFiles(fullPath));
      } else if (stat.isFile() && extname(entry) === '.txt') {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`❌ Erreur lors de la lecture du dossier ${dir}:`, error);
  }
  
  return files;
}

// Fonction principale
function main() {
  const id = process.argv[2];
  
  if (!id) {
    console.error('❌ Usage: bun run index.ts <id>');
    process.exit(1);
  }
  
  const targetDir = join(__dirname, '..', 'index', id);
  
  if (!existsSync(targetDir)) {
    console.error(`❌ Le dossier ${targetDir} n'existe pas`);
    process.exit(1);
  }
  
  console.log(`🔍 Recherche des fichiers .txt dans ${targetDir}...`);
  
  const txtFiles = findTxtFiles(targetDir);
  
  if (txtFiles.length === 0) {
    console.log('⚠️  Aucun fichier .txt trouvé');
    return;
  }
  
  console.log(`📁 ${txtFiles.length} fichier(s) .txt trouvé(s)`);
  
  // Traiter chaque fichier .txt
  for (const txtFile of txtFiles) {
    try {
      console.log(`\n🔐 Chiffrement de ${txtFile}...`);
      
      // Lire le fichier .txt
      const content = readFileSync(txtFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() !== '');
      
      // Chiffrer chaque ligne
      const encryptedLines = lines.map(line => encryptLine(line));
      
      // Créer le chemin du fichier .enc (même nom, même dossier, extension .enc)
      const encFile = txtFile.replace(/\.txt$/, '.enc');
      
      // Écrire le fichier .enc
      writeFileSync(encFile, encryptedLines.join('\n') + '\n', 'utf8');
      
      console.log(`✅ Fichier créé: ${encFile} (${encryptedLines.length} lignes chiffrées)`);
    } catch (error) {
      console.error(`❌ Erreur lors du traitement de ${txtFile}:`, error);
    }
  }
  
  console.log('\n✨ Terminé !');
}

main();
