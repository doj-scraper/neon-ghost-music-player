import type { PlaylistItem } from "@/hooks/useAudioEngine";

type StoredTrack = {
  id: string;
  file: Blob;
  fileName: string;
  fileType: string;
  lastModified: number;
  title: string;
  artist: string;
  album: string;
  artworkBlob?: Blob | null;
  duration: number;
  extension: string;
};

const DB_NAME = "neon-sky-audio";
const DB_VERSION = 1;
const TRACK_STORE = "tracks";
const META_STORE = "meta";

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestToPromise = <T,>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export const saveStoredPlaylist = async (items: PlaylistItem[], currentIndex: number) => {
  const db = await openDb();
  const tx = db.transaction([TRACK_STORE, META_STORE], "readwrite");
  const store = tx.objectStore(TRACK_STORE);
  const meta = tx.objectStore(META_STORE);
  const order = items.map((item) => item.id);

  meta.put(order, "order");
  meta.put(currentIndex, "currentIndex");

  for (const item of items) {
    const stored: StoredTrack = {
      id: item.id,
      file: item.file,
      fileName: item.file.name,
      fileType: item.file.type,
      lastModified: item.file.lastModified,
      title: item.title,
      artist: item.artist,
      album: item.album,
      artworkBlob: item.artworkBlob,
      duration: item.duration,
      extension: item.extension,
    };
    store.put(stored);
  }

  await transactionDone(tx);
  db.close();
};

export const loadStoredPlaylist = async () => {
  const db = await openDb();
  const tx = db.transaction([TRACK_STORE, META_STORE], "readonly");
  const store = tx.objectStore(TRACK_STORE);
  const meta = tx.objectStore(META_STORE);
  const order = (await requestToPromise(meta.get("order"))) as string[] | undefined;
  const currentIndex = (await requestToPromise(meta.get("currentIndex"))) as number | undefined;
  const tracks = await requestToPromise(store.getAll());
  await transactionDone(tx);
  db.close();

  if (!order || !order.length) return { items: [], currentIndex: 0 };
  const trackMap = new Map(tracks.map((item) => [item.id, item]));
  const items = order.map((id) => trackMap.get(id)).filter(Boolean) as StoredTrack[];
  return { items, currentIndex: currentIndex ?? 0 };
};

export const clearStoredPlaylist = async () => {
  const db = await openDb();
  const tx = db.transaction([TRACK_STORE, META_STORE], "readwrite");
  tx.objectStore(TRACK_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await transactionDone(tx);
  db.close();
};
