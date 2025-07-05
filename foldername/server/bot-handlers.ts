import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOTS_DIR = path.join(__dirname, '../bots');

// Ensure bots directory exists
if (!fs.existsSync(BOTS_DIR)) {
  fs.mkdirSync(BOTS_DIR, { recursive: true });
}

export async function readBotFile(req: Request, res: Response) {
  try {
    const file = req.query.file as string;
    if (!file) return res.status(400).json({ error: 'Missing file parameter' });
    
    const filePath = path.join(BOTS_DIR, file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    
    const content = fs.readFileSync(filePath, 'utf-8');
    res.status(200).json({ content });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read file', details: err.message });
  }
}

export async function saveBotFile(req: Request, res: Response) {
  try {
    const { file, content } = req.body;
    if (!file || content === undefined) return res.status(400).json({ error: 'Missing file or content' });
    
    const filePath = path.join(BOTS_DIR, file);
    fs.writeFileSync(filePath, content);
    res.status(200).json({ message: 'File saved successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save file', details: err.message });
  }
}

export async function createBotFile(req: Request, res: Response) {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing bot name' });
    
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(BOTS_DIR, `${safeName}.js`);
    
    if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Bot already exists' });
    
    const defaultTemplate = `// ${safeName}.js

export default async function runBot() {
  console.log('Running ${safeName} bot...');
  // Add your bot logic here
}`;
    
    fs.writeFileSync(filePath, defaultTemplate);
    res.status(201).json({ message: 'Bot created successfully', file: `${safeName}.js` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create bot', details: err.message });
  }
}

export async function listBotFiles(req: Request, res: Response) {
  try {
    if (!fs.existsSync(BOTS_DIR)) {
      return res.status(200).json({ files: [] });
    }
    
    const files = fs.readdirSync(BOTS_DIR)
      .filter(file => file.endsWith('.js') || file.endsWith('.ts'))
      .map(file => ({
        name: file,
        size: fs.statSync(path.join(BOTS_DIR, file)).size,
        modified: fs.statSync(path.join(BOTS_DIR, file)).mtime
      }));
    
    res.status(200).json({ files });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list files', details: err.message });
  }
}