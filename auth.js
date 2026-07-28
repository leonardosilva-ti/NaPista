const CLIENT_ID = '734048624553-99u245jqovloeg0uh18npqgr5ilevplj.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let accessToken = null;

let retryCount = 0;

export function initAuth(onAuthenticated, onNeedsLogin) {
    if (typeof google === 'undefined' || !google.accounts) {
        console.error("Google API não carregada.");
        retryCount++;
        if (retryCount > 10) {
            alert("Erro: A biblioteca do Google não foi carregada. Verifique sua conexão ou desative bloqueadores de anúncios.");
            return;
        }
        setTimeout(() => initAuth(onAuthenticated, onNeedsLogin), 500);
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
            } else {
                alert("Falha ao obter token do Google. Verifique o console.");
            }
        },
    });

    // Tentar pegar token salvo temporariamente
    const savedToken = localStorage.getItem('napista_token');
    if (savedToken) {
        accessToken = savedToken;
        onAuthenticated();
    } else if (onNeedsLogin) {
        onNeedsLogin();
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
