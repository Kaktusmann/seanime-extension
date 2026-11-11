const fs = require('fs');
const path = require('path');

// Configuration
const SRC_DIR = path.join(__dirname, 'src');
const OUTPUT_FILE = path.join(__dirname, 'animethemes.ts');

// 1. Read the separate files
console.log("Reading source files...");
const mainTs = fs.readFileSync(path.join(SRC_DIR, 'main.ts'), 'utf8');
const css = fs.readFileSync(path.join(SRC_DIR, 'player.css'), 'utf8');
const html = fs.readFileSync(path.join(SRC_DIR, 'player.html'), 'utf8');
const js = fs.readFileSync(path.join(SRC_DIR, 'player.js'), 'utf8');

// 2. Helper to make strings safe for injection
// We use JSON.stringify to automatically handle escaping quotes and newlines,
// then slice(1, -1) to remove the surrounding quotes it adds, because
// we want to inject it into an existing string or template literal.
function sanitize(str) {
    // We strictly use JSON.stringify to ensure valid JS string syntax
    // This turns:  Hello "World"
    // Into:       "Hello \"World\""
    return JSON.stringify(str);
}

// 3. Replace placeholders
// Note: In main.ts, use: const PLAYER_CSS = "__PLAYER_CSS__";
// We replace the entire string including quotes: "__PLAYER_CSS__"
console.log("Injecting assets...");

let output = mainTs;

// We replace the placeholder AND its surrounding quotes in the TS file
// if you used const X = "__PLACEHOLDER__";
output = output.replace(/"__PLAYER_CSS__"/g, sanitize(css));
output = output.replace(/"__PLAYER_HTML__"/g, sanitize(html));
output = output.replace(/"__PLAYER_JS__"/g, sanitize(js));

// 4. Write the final file
fs.writeFileSync(OUTPUT_FILE, output);

console.log(`✅ Success! Built ${OUTPUT_FILE}`);