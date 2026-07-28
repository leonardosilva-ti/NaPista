import { initAuth, login, logout } from './auth.js';
import { findDataFile, readData, saveData, deleteData } from './drive.js';
import { defaultData, calculateDailyTargets, getTodayStats } from './logic.js';

let appData = null;
let fileId = null;

// UI Elements
const screens = document.querySelectorAll('.screen');
const loadingScreen = document.getElementById('loading-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const reportsScreen = document.getElementById('reports-screen');
const profileScreen = document.getElementById('profile-screen');

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.target));
});

function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    if (screenId === 'dashboard-screen') renderDashboard();
    if (screenId === 'reports-screen') renderReports('tab-day');
}

// Init
window.onload = () => {
    initAuth(onAuthenticated);
};

// Login Flow
document.getElementById('btn-login').addEventListener('click', login);

async function onAuthenticated() {
    showScreen('loading-screen');
    try {
        fileId = await findDataFile();
        if (fileId) {
            appData = await readData(fileId);
            // Verifica se precisa de setup
            if (!appData.settings || appData.settings.diasTrabalhoMes === 0) {
                renderSetup();
                showScreen('setup-screen');
            } else {
                showScreen('dashboard-screen');
            }
        } else {
            appData = JSON.parse(JSON.stringify(defaultData));
            renderSetup();
            showScreen('setup-screen');
        }
    } catch (e) {
        console.error(e);
        alert("Erro ao carregar dados do Drive.");
        showScreen('login-screen');
    }
}

// --- SETUP SCREEN ---
let tempPlatforms = [];

function renderSetup() {
    tempPlatforms = appData.settings.plataformas || [...defaultData.settings.plataformas];
    
    document.getElementById('setup-dias').value = appData.settings.diasTrabalhoMes || '';
    document.getElementById('setup-meta').value = appData.settings.metaLiquidaMensal || '';
    document.getElementById('setup-pagamento-km').value = appData.settings.mediaPagamentoKm || '';
    document.getElementById('setup-consumo').value = appData.settings.mediaConsumoL || '';
    document.getElementById('setup-preco-comb').value = appData.settings.mediaPrecoCombustivel || '';
    
    renderPlatformsList();
}

function renderPlatformsList() {
    const list = document.getElementById('setup-platforms-list');
    list.innerHTML = '';
    tempPlatforms.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = 'platform-tag active';
        div.textContent = p;
        div.onclick = () => {
            tempPlatforms.splice(idx, 1);
            renderPlatformsList();
        };
        list.appendChild(div);
    });
}

document.getElementById('btn-add-platform').addEventListener('click', () => {
    const inp = document.getElementById('setup-new-platform');
    if (inp.value.trim()) {
        tempPlatforms.push(inp.value.trim());
        inp.value = '';
        renderPlatformsList();
    }
});

document.getElementById('btn-finish-setup').addEventListener('click', async () => {
    const dias = parseInt(document.getElementById('setup-dias').value);
    const meta = parseFloat(document.getElementById('setup-meta').value);
    const pag = parseFloat(document.getElementById('setup-pagamento-km').value);
    const cons = parseFloat(document.getElementById('setup-consumo').value);
    const pre = parseFloat(document.getElementById('setup-preco-comb').value);

    if (!dias || !meta || !pag || !cons || !pre || tempPlatforms.length === 0) {
        alert("Preencha todos os campos e adicione pelo menos uma plataforma.");
        return;
    }

    appData.settings = {
        diasTrabalhoMes: dias,
        metaLiquidaMensal: meta,
        mediaPagamentoKm: pag,
        mediaConsumoL: cons,
        mediaPrecoCombustivel: pre,
        plataformas: tempPlatforms
    };

    showScreen('loading-screen');
    try {
        fileId = await saveData(fileId, appData);
        showScreen('dashboard-screen');
    } catch (e) {
        console.error(e);
        alert("Erro ao salvar configurações.");
    }
});

// --- DASHBOARD SCREEN ---
function renderDashboard() {
    const stats = calculateDailyTargets(appData.settings, appData.history);
    const todayStats = getTodayStats(appData.history);
    
    const dashFalta = document.getElementById('dash-falta-hoje');
    const dashMeta = document.getElementById('dash-meta-diaria-info');
    const dashKm = document.getElementById('dash-km-recomendado');
    const bar = document.getElementById('dash-progress-bar');
    const metaCard = document.getElementById('card-meta');

    if (stats.error) {
        dashFalta.textContent = "Erro!";
        dashMeta.textContent = stats.error;
        return;
    }

    if (stats.metaAlcancada) {
        dashFalta.textContent = `+ R$ ${stats.excedenteMensal.toFixed(2)}`;
        dashFalta.className = 'metric-large';
        dashMeta.textContent = "Meta Mensal Atingida! 🎉";
        dashKm.textContent = "Uma folga sempre é bem vinda!";
        bar.style.width = '100%';
        bar.style.background = 'var(--accent-secondary)';
    } else {
        const metaDiariaOriginal = stats.metaBrutaDiaria;
        const faltaHoje = metaDiariaOriginal - todayStats.totalEarned;
        
        if (faltaHoje <= 0) {
            dashFalta.textContent = `+ R$ ${Math.abs(faltaHoje).toFixed(2)}`;
            dashFalta.className = 'metric-large';
            dashMeta.textContent = `Meta do dia batida (Excedente)`;
            bar.style.width = '100%';
            bar.style.background = 'var(--accent-secondary)';
        } else {
            dashFalta.textContent = `R$ ${faltaHoje.toFixed(2)}`;
            dashFalta.className = 'metric-large metric-danger';
            dashMeta.textContent = `Meta bruta do dia: R$ ${metaDiariaOriginal.toFixed(2)}`;
            const perc = (todayStats.totalEarned / metaDiariaOriginal) * 100;
            bar.style.width = `${perc}%`;
            bar.style.background = 'var(--accent-primary)';
        }
        dashKm.textContent = `Recomendado rodar: ${stats.kmDiario.toFixed(0)} km hoje`;
    }

    // Render Platform Inputs
    const platContainer = document.getElementById('dash-platform-inputs');
    platContainer.innerHTML = '';
    appData.settings.plataformas.forEach(p => {
        const group = document.createElement('div');
        group.className = 'input-group';
        group.innerHTML = `
            <label>Ganho ${p} (R$)</label>
            <input type="number" step="0.01" class="plat-input" data-plat="${p}" value="${todayStats.earnings[p] || ''}" placeholder="0.00">
        `;
        platContainer.appendChild(group);
    });

    document.getElementById('dash-km').value = todayStats.km || '';
    document.getElementById('dash-refuel').value = getTodayRefuel(appData.history) || '';
    document.getElementById('dash-expenses').value = todayStats.expenses - (getTodayRefuel(appData.history) || 0) || '';
}

function getTodayRefuel(history) {
    const hojeStr = new Date().toISOString().split('T')[0];
    const t = history.find(h => h.date === hojeStr);
    return t ? parseFloat(t.refuel || 0) : 0;
}

document.getElementById('btn-save-day').addEventListener('click', async () => {
    const hojeStr = new Date().toISOString().split('T')[0];
    let dayData = appData.history.find(h => h.date === hojeStr);
    
    if (!dayData) {
        dayData = { date: hojeStr, earnings: {}, km: 0, refuel: 0, expenses: 0 };
        appData.history.push(dayData);
    }

    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseFloat(inp.value);
        if (val) dayData.earnings[inp.dataset.plat] = val;
        else delete dayData.earnings[inp.dataset.plat];
    });

    dayData.km = parseFloat(document.getElementById('dash-km').value) || 0;
    dayData.refuel = parseFloat(document.getElementById('dash-refuel').value) || 0;
    
    const extraExp = parseFloat(document.getElementById('dash-expenses').value) || 0;
    dayData.expenses = extraExp; // refuel não entra em expenses aqui para separar

    document.getElementById('btn-save-day').textContent = "Salvando...";
    try {
        fileId = await saveData(fileId, appData);
        document.getElementById('btn-save-day').textContent = "Salvo!";
        setTimeout(() => { document.getElementById('btn-save-day').textContent = "Salvar Lançamentos"; }, 2000);
        renderDashboard();
    } catch(e) {
        alert("Erro ao salvar.");
        document.getElementById('btn-save-day').textContent = "Salvar Lançamentos";
    }
});

// --- REPORTS SCREEN ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderReports(btn.dataset.tab);
    });
});

function renderReports(tabId) {
    const content = document.getElementById('report-content');
    let html = '';
    
    const history = [...appData.history].reverse(); // Do mais recente
    
    if (history.length === 0) {
        content.innerHTML = '<p class="text-center">Nenhum dado registrado ainda.</p>';
        return;
    }

    if (tabId === 'tab-day') {
        history.slice(0, 7).forEach(h => {
            let total = 0;
            for(let k in h.earnings) total += (parseFloat(h.earnings[k])||0);
            html += `
                <div style="border-bottom: 1px solid var(--border-color); padding: 10px 0;">
                    <div class="d-flex justify-between">
                        <strong>${h.date}</strong>
                        <span style="color:var(--accent-secondary)">R$ ${total.toFixed(2)}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        KM: ${h.km} | Abastec: R$ ${h.refuel} | Gastos: R$ ${h.expenses}
                    </div>
                </div>
            `;
        });
    } else {
        html = '<p class="text-center">Aguardando implementação avançada de gráficos.</p>';
    }
    
    content.innerHTML = html;
}

// --- PROFILE SCREEN ---
document.getElementById('btn-reconfig').addEventListener('click', () => {
    renderSetup();
    showScreen('setup-screen');
});

document.getElementById('btn-wipe-data').addEventListener('click', async () => {
    if (confirm("TEM CERTEZA? Isso apagará todos os seus dados do Google Drive permanentemente.")) {
        showScreen('loading-screen');
        try {
            await deleteData(fileId);
            fileId = null;
            appData = null;
            logout();
            showScreen('login-screen');
        } catch(e) {
            alert("Erro ao apagar os dados.");
            showScreen('profile-screen');
        }
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    appData = null;
    fileId = null;
    showScreen('login-screen');
});
