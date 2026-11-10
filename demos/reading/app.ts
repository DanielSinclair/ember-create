import type { Answer, Sources, Storage } from './app.contract.d.ts';
import { configureMuse, museSearchBook, museImage, saveMuseImage } from './muse';

export const grants = 'fs.read app:/data\nfs.write app:/data\ndevice.health-read purpose.health\nnet.fetch https://openrouter.ai';
const OPENROUTER_KEY = import.meta.env.OPENROUTER_API_KEY ?? '';
configureMuse(OPENROUTER_KEY);
const BOOKS = 'app:/data/reading-books.json';
type Book = { id: string; title: string; author: string; description: string; cover: string };
type SearchResult = { ok: boolean; title: string; author: string; description: string; coverDescription: string; uncertainty: string; error: string };
const emptySearch = (error: string): SearchResult => ({ ok: false, title: '', author: '', description: '', coverDescription: '', uncertainty: '', error });
const message = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';

async function readJSON(storage: Storage, path: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await storage.fs.readFile(path)));
}
async function loadBooks(storage: Storage): Promise<Book[]> {
  try {
    const value = await readJSON(storage, BOOKS);
    if (!Array.isArray(value) || value.some(book => !book || ['id', 'title', 'author', 'description', 'cover'].some(key => typeof book[key] !== 'string'))) throw new Error('The saved bookshelf could not be read.');
    const books = value as Book[];
    let changed = false;
    for (const book of books) {
      if (book.cover.startsWith('data:image/')) {
        book.cover = (await saveMuseImage(book.cover, `app:/data/reading-cover-${crypto.randomUUID()}.png`, storage)).path;
        changed = true;
      }
    }
    if (changed) await saveBooks(storage, books);
    return books;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }
}
async function saveBooks(storage: Storage, books: Book[]) {
  await storage.fs.atomicWriteFile(BOOKS, new TextEncoder().encode(JSON.stringify(books)));
}
const sources: Sources = {
  loadBooks: (_args, _store, storage) => loadBooks(storage),
  searchBook: async ([title, description], _store, storage): Promise<SearchResult> => {
    if (!title && !description) return emptySearch('Add a title or a few clues first.');
    try {
      const result = await museSearchBook(title, description);
      if (result.costUsd !== undefined) console.info(`Muse book search cost USD: ${result.costUsd}`);
      if (!result.candidate) return emptySearch(result.uncertainty || 'No confident match yet. Add another clue.');
      const book = result.candidate;
      if ([book.title, book.author, book.description, book.coverDescription].some(value => typeof value !== 'string')) return emptySearch('The book match was incomplete. Please try again.');
      return { ok: true, title: book.title, author: book.author, description: book.description, coverDescription: book.coverDescription, uncertainty: typeof result.uncertainty === 'string' ? result.uncertainty : 'A possible match from model memory.', error: '' };
    } catch (error) { return emptySearch(message(error)); }
  },
  addBook: async ([title, author, description, coverDescription], _store, storage) => {
    try {
      const books = await loadBooks(storage);
      const id = `${title.trim().toLowerCase()}::${author.trim().toLowerCase()}`;
      if (books.some(book => book.id === id)) return { ok: false, error: 'This book is already on your shelf.' };
      const art = await museImage(`Create a beautiful portrait book-cover reconstruction for ${title} by ${author}. Follow this visual description as closely as possible: ${coverDescription}. Story: ${description}. Flat front cover only, no mockup, no perspective, no surrounding props. The app labels this as an AI reconstruction.`);
      if (art.costUsd !== undefined) console.info(`Muse cover cost USD: ${art.costUsd}`);
      if (typeof art.dataUri !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(art.dataUri)) return { ok: false, error: 'The cover could not be loaded. Please try again.' };
      const cover = await saveMuseImage(art.dataUri, `app:/data/reading-cover-${crypto.randomUUID()}.png`, storage);
      await saveBooks(storage, [...books, { id, title, author, description, cover: cover.path }]);
      return { ok: true, error: '' };
    } catch (error) { return { ok: false, error: message(error) }; }
  },
  removeBook: async ([id], _store, storage) => {
    try { await saveBooks(storage, (await loadBooks(storage)).filter(book => book.id !== id)); return { ok: true, error: '' }; }
    catch (error) { return { ok: false, error: message(error) }; }
  },
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
