import fs from 'fs';
import path from 'path';

const rawPath = path.join(process.cwd(), 'blocklist.txt');
const outputPath = path.join(process.cwd(), 'defaultBlocklist.js');

console.log('Parsing blocklist.txt...');

const rawData = fs.readFileSync(rawPath, 'utf-8');
const lines = rawData.split('\n');

const validDomains = new Set();

for (let line of lines) {
  line = line.trim();
  // Skip blank lines and header comments starting with #
  if (!line || line.startsWith('#')) continue;
  
  // Clean off accidental www. prefixes or trailing slashes
  const cleanDomain = line.replace(/^www\./, '').toLowerCase();
  if (cleanDomain) {
    validDomains.add(cleanDomain);
  }
}

const jsContent = `// Auto-generated blocklist set
export const DEFAULT_BLOCKLIST = new Set(${JSON.stringify(Array.from(validDomains))});
`;

fs.writeFileSync(outputPath, jsContent, 'utf-8');
console.log(`Success! Compiled ${validDomains.size} unique domains into defaultBlocklist.js`);