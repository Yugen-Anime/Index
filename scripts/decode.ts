import { createDecipheriv } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
	const envContent = readFileSync(envPath, "utf8");
	for (const line of envContent.split("\n")) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith("#")) {
			const [key, ...valueParts] = trimmed.split("=");
			if (key && valueParts.length > 0) {
				process.env[key.trim()] = valueParts.join("=").trim();
			}
		}
	}
}

const KEY = process.env.KEY;

if (!KEY) {
	console.error("❌ La clé KEY n'est pas définie dans le fichier .env");
	process.exit(1);
}

let keyBuffer: Buffer;
try {
	keyBuffer = Buffer.from(KEY, "base64");
	if (keyBuffer.length !== 32) {
		console.error(
			"❌ La clé doit faire 32 bytes (256 bits) après décodage base64",
		);
		process.exit(1);
	}
} catch (error) {
	console.error("❌ Erreur lors du décodage de la clé base64:", error);
	process.exit(1);
}

function decryptLine(encryptedLine: string): string {
	const parts = encryptedLine.split(":");

	if (parts.length !== 4 || parts[0] !== "v1") {
		throw new Error(`Format invalide: ${encryptedLine.substring(0, 50)}...`);
	}

	const [, iv_b64, tag_b64, cipher_b64] = parts;

	let iv: Buffer;
	let tag: Buffer;
	let cipher: Buffer;

	try {
		iv = Buffer.from(iv_b64, "base64");
		tag = Buffer.from(tag_b64, "base64");
		cipher = Buffer.from(cipher_b64, "base64");
	} catch (error) {
		throw new Error(`Erreur lors du décodage base64: ${error}`);
	}

	if (iv.length !== 12) {
		throw new Error(`IV invalide: attendu 12 bytes, obtenu ${iv.length}`);
	}
	if (tag.length !== 16) {
		throw new Error(`Tag invalide: attendu 16 bytes, obtenu ${tag.length}`);
	}

	const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);

	decipher.setAuthTag(tag);

	let decrypted = decipher.update(cipher);
	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString("utf8");
}

function findEncFiles(dir: string): string[] {
	const files: string[] = [];

	try {
		const entries = readdirSync(dir);

		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);

			if (stat.isDirectory()) {
				files.push(...findEncFiles(fullPath));
			} else if (stat.isFile() && extname(entry) === ".enc") {
				files.push(fullPath);
			}
		}
	} catch (error) {
		console.error(`❌ Erreur lors de la lecture du dossier ${dir}:`, error);
	}

	return files;
}

function main() {
	const id = process.argv[2];

	if (!id) {
		console.error("❌ Usage: bun run decode.ts <id>");
		process.exit(1);
	}

	const targetDir = join(__dirname, "..", "index", id);

	if (!existsSync(targetDir)) {
		console.error(`❌ Le dossier ${targetDir} n'existe pas`);
		process.exit(1);
	}

	console.log(`🔍 Recherche des fichiers .enc dans ${targetDir}...`);

	const encFiles = findEncFiles(targetDir);

	if (encFiles.length === 0) {
		console.log("⚠️  Aucun fichier .enc trouvé");
		return;
	}

	console.log(`📁 ${encFiles.length} fichier(s) .enc trouvé(s)`);

	for (const encFile of encFiles) {
		try {
			console.log(`\n🔓 Déchiffrement de ${encFile}...`);

			const content = readFileSync(encFile, "utf8");
			const lines = content.split("\n").filter((line) => line.trim() !== "");

			const decryptedLines: string[] = [];
			let errorCount = 0;

			for (let i = 0; i < lines.length; i++) {
				try {
					const decrypted = decryptLine(lines[i]);
					decryptedLines.push(decrypted);
				} catch (error) {
					console.error(`  ⚠️  Erreur ligne ${i + 1}: ${error}`);
					errorCount++;
				}
			}

			if (errorCount > 0) {
				console.error(`  ❌ ${errorCount} erreur(s) lors du déchiffrement`);
				continue;
			}

			const txtFile = encFile.replace(/\.enc$/, ".txt");

			writeFileSync(txtFile, `${decryptedLines.join("\n")}\n`, "utf8");

			console.log(
				`✅ Fichier créé: ${txtFile} (${decryptedLines.length} lignes déchiffrées)`,
			);
		} catch (error) {
			console.error(`❌ Erreur lors du traitement de ${encFile}:`, error);
		}
	}

	console.log("\n✨ Terminé !");
}

main();
