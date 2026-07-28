const CLIENT_ID = 'COLOQUE_SEU_CLIENT_ID_AQUI'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;

export function initAuth(onAuthenticated) {
    if (typeof google === 'undefined' || !google.accounts) {
        console.error("Google API não carregada.");
        setTimeout(() => initAuth(onAuthenticated), 500);
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                localStorage.setItem('napista_token', accessToken);
                onAuthenticated();
            }
        },
    });

    // Tentar pegar token salvo temporariamente (não ideal para longo prazo, mas útil em refresh da aba)
    const savedToken = localStorage.getItem('napista_token');
    if (savedToken) {
        accessToken = savedToken;
        onAuthenticated();
    }
}

export function login() {
    if (tokenClient) {
        tokenClient.requestAccessToken();
    }
}

export function logout() {
    accessToken = null;
    localStorage.removeItem('napista_token');
}

export function getAccessToken() {
    return accessToken;
}
