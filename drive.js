// Persistência no Google Drive (pasta privada do app: appDataFolder).
import { getToken, invalidateToken } from './auth.js?v=2.6.2';

const FILENAME = 'napista_data.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

async function request(url, options = {}) {
    const token = await getToken();
    const res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });

    // Token rejeitado: descarta. Renovar exige um toque do usuário (popup),
    // então quem chamou decide quando pedir de novo.
    if (res.status === 401) invalidateToken();
    if (!res.ok) {
        const err = new Error(`Drive API ${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
    }
    return res;
}

export async function findDataFile() {
    const q = encodeURIComponent(`name='${FILENAME}' and 'appDataFolder' in parents and trashed=false`);
    const url = `${API}?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)`;
    const data = await (await request(url)).json();
    return data.files?.[0]?.id ?? null;
}

export async function readData(fileId) {
    const res = await request(`${API}/${fileId}?alt=media`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

export async function saveData(fileId, jsonData) {
    const boundary = 'napista' + Math.random().toString(36).slice(2);
    const metadata = fileId
        ? { name: FILENAME, mimeType: 'application/json' }
        : { name: FILENAME, mimeType: 'application/json', parents: ['appDataFolder'] };

    const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(jsonData)}\r\n` +
        `--${boundary}--`;

    const url = fileId
        ? `${UPLOAD}/${fileId}?uploadType=multipart&fields=id`
        : `${UPLOAD}?uploadType=multipart&fields=id`;

    const res = await request(url, {
        method: fileId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
    });
    return (await res.json()).id;
}

export async function deleteData(fileId) {
    if (!fileId) return;
    await request(`${API}/${fileId}`, { method: 'DELETE' });
}

/** E-mail da conta (usado como dica para renovar o login sem escolher conta). */
export async function getUserEmail() {
    const res = await request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    return (await res.json())?.user?.emailAddress || '';
}
