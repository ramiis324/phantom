import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, "index.html");
const OUT = join(__dirname, "movies-folders.js");
const MAX_DEPTH = 6;
const MAX_FETCHES = 600;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ENTRY_RE = /<a href="([^"]*?(?:drive\/folders|file\/d)\/([A-Za-z0-9_-]+)[^"]*)"[^>]*>(?:(?!<\/a>)[\s\S])*?flip-entry-title">([^<]+)<\/div><\/a>/g;

function folderId(url) {
	const m = String(url).match(/\/drive\/folders\/([A-Za-z0-9_-]+)/);
	return m ? m[1] : null;
}

function discoverMovies() {
	const html = readFileSync(INDEX, "utf8");
	const out = new Map();
	const re = /\{\s*"name":\s*"([^"]+)",\s*"url":\s*"([^"]+)",\s*"noaboutblank":\s*true\s*\}/g;
	let mm;
	while ((mm = re.exec(html)) !== null) {
		const id = folderId(mm[2]);
		if (id) out.set(id, { id, name: mm[1], url: mm[2] });
	}
	return [...out.values()];
}

async function fetchHtml(id) {
	const url = `https://drive.google.com/embeddedfolderview?id=${id}`;
	const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,*/*" }, redirect: "follow" });
	if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
	return await res.text();
}

function parseListing(html) {
	const folders = [];
	const files = [];
	ENTRY_RE.lastIndex = 0;
	let m;
	while ((m = ENTRY_RE.exec(html)) !== null) {
		const href = m[1];
		const key = m[2];
		const name = m[3].trim();
		if (folderId(href)) folders.push({ key, name });
		else files.push({ key, name });
	}
	return { folders, files };
}

async function walk(id, name, depth, stats) {
	stats.fetches++;
	if (depth > MAX_DEPTH || stats.fetches > MAX_FETCHES) {
		return { id, name, folders: [], files: [], incomplete: true };
	}
	let html;
	try {
		html = await fetchHtml(id);
	} catch (e) {
		console.log("  ! fetch failed", id, e.message);
		return { id, name, folders: [], files: [], error: String(e.message), incomplete: true };
	}
	const { folders, files } = parseListing(html);
	const node = { id, name, folders: [], files: files.map(f => ({ id: f.key, name: f.name })) };
	for (const f of folders) {
		await new Promise(r => setTimeout(r, 120));
		node.folders.push(await walk(f.key, f.name, depth + 1, stats));
	}
	return node;
}

const movies = discoverMovies();
console.log("Folders found in index.html:", movies.length);
const stats = { fetches: 0 };
const tree = {};
for (const m of movies) {
	console.log("Fetching:", m.name, m.id);
	await new Promise(r => setTimeout(r, 150));
	tree[m.id] = await walk(m.id, m.name, 0, stats);
}
console.log("Total fetches:", stats.fetches);
const body = "window.FOLDER_MOVIES = " + JSON.stringify(tree) + ";\n";
writeFileSync(OUT, body, "utf8");
console.log("Wrote", OUT, body.length, "bytes");