import { getAccessToken } from './auth.js';

const FILENAME = 'napista_data.json';

// Helper to make API calls to Drive
async function driveApiCall(url, method = 'GET', body = null, isMultipart = false, boundary = '') {
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${getAccessToken()}`);
    
    if (isMultipart) {
        headers.append('Content-Type', `multipart/related; boundary=${boundary}`);
    } else if (body && method !== 'GET') {
        headers.append('Content-Type', 'application/json');
    }

    const options = { method, headers };
    if (body) options.body = body;

    const response = await fetch(url, options);
    if (!response.ok) {
        if (response.status === 401) {
             console.error("Token expirado ou inválido.");
             // Pode disparar um evento para refazer login aqui
        }
        throw new Error(`Drive API Error: ${response.status} ${response.statusText}`);
    }
    
    // 204 No Content for delete
    if (response.status === 204) return null;
    
    return response.json();
}

// Find file in appDataFolder
export async function findDataFile() {
    const query = encodeURIComponent(`name='${FILENAME}' and 'appDataFolder' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name)`;
    
    const data = await driveApiCall(url);
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }
    return null;
}

// Read JSON data from file ID
export async function readData(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${getAccessToken()}`
        }
    });
    
    if (!response.ok) throw new Error("Erro ao ler conteúdo do arquivo.");
    return response.json();
}

// Create or update data file in appDataFolder
export async function saveData(fileId, jsonData) {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const close_delim = `\r\n--${boundary}--`;

    const metadata = {
        name: FILENAME,
        mimeType: 'application/json',
        parents: fileId ? undefined : ['appDataFolder']
    };

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(jsonData) +
        close_delim;

    let url, method;
    if (fileId) {
        // Update
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = 'PATCH';
    } else {
        // Create
        url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        method = 'POST';
    }

    const response = await driveApiCall(url, method, multipartRequestBody, true, boundary);
    return response.id;
}

// Delete file
export async function deleteData(fileId) {
    if (!fileId) return;
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
    await driveApiCall(url, 'DELETE');
}
