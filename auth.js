// Autenticação via Google Identity Services (token OAuth de curta duração).

const CLIENT_ID = '734048624553-99u245jqovloeg0uh18npqgr5ilevplj.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const STORAGE_KEY = 'napista_auth';
const EXPIRY_MARGIN_MS = 60 * 1000;

let tokenClient = null;
let accessToken = null;
let expiresAt = 0;
let pending = null;

export class AuthError extends Error {
    constructor(message, type) {
        super(message);
        this.name = 'AuthError';
        this.type = type;
    }
}

function waitForGoogle(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        (function check() {
            if (window.google?.accounts?.oauth2) return resolve();
            if (Date.now() - t0 > timeoutMs) {
                return reject(new AuthError('A biblioteca de login do Google não carregou.', 'gis_not_loaded'));
            }
            setTimeout(check, 200);
        })();
    });
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: accessToken, expiresAt }));
    } catch { /* armazenamento indisponível */ }
}

function restore() {
    try {
        localStorage.removeItem('napista_token'); // formato antigo, sem validade
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved?.token && saved.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
            accessToken = saved.token;
            expiresAt = saved.expiresAt;
        }
    } catch { /* ignora */ }
}

/** Inicializa o cliente. Resolve `true` se já existe uma sessão válida salva. */
export async function initAuth() {
    await waitForGoogle();
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            const p = pending;
            pending = null;
            if (resp?.access_token) {
                accessToken = resp.access_token;
                expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
                persist();
                p?.resolve(accessToken);
            } else {
                p?.reject(new AuthError(resp?.error_description || 'Falha ao obter acesso.', resp?.error));
            }
        },
        error_callback: (err) => {
            const p = pending;
            pending = null;
            p?.reject(new AuthError(err?.message || 'Login cancelado.', err?.type));
        }
    });
    restore();
    return hasValidToken();
}

// Precisa ser chamado de forma síncrona dentro de um clique (popup).
function requestToken(prompt = '') {
    if (!tokenClient) return Promise.reject(new AuthError('Login ainda não está pronto.', 'not_ready'));
    return new Promise((resolve, reject) => {
        pending?.reject(new AuthError('Substituído por nova solicitação.', 'superseded'));
        // Evita promessas penduradas se o popup ficar aberto ou for bloqueado sem aviso
        const timer = setTimeout(() => {
            if (pending?.resolve === wrappedResolve) {
                pending = null;
                reject(new AuthError('Tempo esgotado aguardando o login.', 'timeout'));
            }
        }, 120000);
        const wrappedResolve = (t) => { clearTimeout(timer); resolve(t); };
        const wrappedReject = (e) => { clearTimeout(timer); reject(e); };
        pending = { resolve: wrappedResolve, reject: wrappedReject };
        tokenClient.requestAccessToken({ prompt });
    });
}

export function hasValidToken() {
    return !!accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS;
}

export function login() {
    return requestToken('');
}

/** Retorna um token válido, renovando (popup rápido) se tiver expirado. */
export function getToken() {
    if (hasValidToken()) return Promise.resolve(accessToken);
    return requestToken('');
}

export function invalidateToken() {
    accessToken = null;
    expiresAt = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignora */ }
}

export function logout() {
    invalidateToken();
}
