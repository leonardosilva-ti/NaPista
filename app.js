import { initAuth, login, logout } from './auth.js';
import { findDataFile, readData, saveData, deleteData } from './drive.js';
import { defaultData, calculateTargets, getDayStats } from './logic.js';

let appData = null;
let fileId = null;
let currentScope = 'day'; // day, week, month

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
    
    if (screenId === 'dashboard-screen') initDashboard();
    if (screenId === 'reports-screen') renderReports('tab-day');
}

// Init
window.onload = () => {
    initAuth(onAuthenticated, () => {
        showScreen('login-screen');
    });
};

// Login Flow
document.getElementById('btn-login').addEventListener('click', login);

async function onAuthenticated() {
    showScreen('loading-screen');
    try {
        fileId = await findDataFile();
        if (fileId) {
            appData = await readData(fileId);
            if (!appData || !appData.settings || appData.settings.diasTrabalhoMes === 0) {
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
        alert(`Erro na comunicação com o Google Drive: ${e.message}\nVerifique se ativou a API do Google Drive no Cloud Console.`);
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
        div.innerHTML = `${p} <span style="margin-left:8px; font-weight:bold; color:var(--accent-danger)">x</span>`;
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
const dateInput = document.getElementById('dash-date');
let isDashboardInitialized = false;

function initDashboard() {
    if (!isDashboardInitialized) {
        dateInput.value = new Date().toISOString().split('T')[0];
        dateInput.addEventListener('change', loadDashboardData);
        
        // Render Platform Inputs just once per settings
        const platContainer = document.getElementById('dash-platform-inputs');
        platContainer.innerHTML = '';
        appData.settings.plataformas.forEach(p => {
            const group = document.createElement('div');
            group.className = 'input-group';
            group.innerHTML = `
                <label>Ganho ${p} (R$)</label>
                <input type="number" step="0.01" class="plat-input live-calc" data-plat="${p}" placeholder="0.00">
            `;
            platContainer.appendChild(group);
        });

        // Listeners for live calc
        document.querySelectorAll('.live-calc').forEach(inp => {
            inp.addEventListener('input', updateDashboardTargets);
        });
        document.getElementById('dash-km').addEventListener('input', updateDashboardTargets);
        document.getElementById('dash-consumo-dia').addEventListener('input', updateDashboardTargets);
        document.getElementById('dash-preco-litro').addEventListener('input', updateDashboardTargets);
        document.getElementById('dash-expenses').addEventListener('input', updateDashboardTargets);

        // Scope Tabs
        document.querySelectorAll('.dash-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentScope = btn.dataset.scope;
                updateDashboardTargets();
            });
        });

        isDashboardInitialized = true;
    }
    loadDashboardData();
}

function loadDashboardData() {
    const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
    const dayStats = getDayStats(appData.history, selectedDate);
    
    document.querySelectorAll('.plat-input').forEach(inp => {
        inp.value = dayStats.earnings[inp.dataset.plat] || '';
    });

    document.getElementById('dash-km').value = dayStats.km || '';
    document.getElementById('dash-consumo-dia').value = dayStats.consumoL || '';
    document.getElementById('dash-preco-litro').value = dayStats.precoL || '';
    document.getElementById('dash-expenses').value = dayStats.expenses || '';
    
    updateDashboardTargets();
}

function updateDashboardTargets() {
    const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
    
    // Ler os dados provisórios digitados
    const currentDayInputs = { earnings: {}, km: 0, consumoL: 0, precoL: 0, expenses: 0 };
    let currentTotalEarned = 0;
    
    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseFloat(inp.value);
        if (val) {
            currentDayInputs.earnings[inp.dataset.plat] = val;
            currentTotalEarned += val;
        }
    });
    
    currentDayInputs.km = parseFloat(document.getElementById('dash-km').value) || 0;
    currentDayInputs.consumoL = parseFloat(document.getElementById('dash-consumo-dia').value) || appData.settings.mediaConsumoL;
    currentDayInputs.precoL = parseFloat(document.getElementById('dash-preco-litro').value) || appData.settings.mediaPrecoCombustivel;
    currentDayInputs.expenses = parseFloat(document.getElementById('dash-expenses').value) || 0;
    
    const stats = calculateTargets(currentScope, appData.settings, appData.history, selectedDate, currentDayInputs);
    
    const dashFalta = document.getElementById('dash-falta-hoje');
    const dashMeta = document.getElementById('dash-meta-diaria-info');
    const dashSugerida = document.getElementById('dash-meta-sugerida');
    const dashKm = document.getElementById('dash-km-recomendado');
    const bar = document.getElementById('dash-progress-bar');
    
    // Atualiza subtitulos da UI de forma reativa
    const mediaFormatada = currentDayInputs.km > 0 && currentTotalEarned > 0 
        ? (currentTotalEarned / currentDayInputs.km).toFixed(2) 
        : '0.00';
        
    document.getElementById('dash-total-feito').textContent = `Feito: R$ ${currentTotalEarned.toFixed(2)}`;
    document.getElementById('dash-media-km').textContent = `Média: R$ ${mediaFormatada}/km`;

    if (stats.error) {
        dashFalta.textContent = "Erro!";
        dashMeta.textContent = stats.error;
        dashSugerida.style.display = 'none';
        return;
    }

    if (stats.metaAlcancada) {
        dashFalta.textContent = `+ R$ ${stats.excedente.toFixed(2)}`;
        dashFalta.className = 'metric-large';
        dashMeta.textContent = "Parabéns, você bateu a meta! 🎉";
        dashSugerida.style.display = 'none';
        dashKm.textContent = "Uma folga sempre é bem vinda!";
        bar.style.width = '100%';
        bar.style.background = 'var(--accent-secondary)';
    } else {
        const metaOriginal = stats.metaBrutaPeriodoRestante;
        const faltaValor = metaOriginal - currentTotalEarned;
        
        if (faltaValor <= 0) {
            dashFalta.textContent = `+ R$ ${Math.abs(faltaValor).toFixed(2)}`;
            dashFalta.className = 'metric-large';
            dashMeta.textContent = `Parabéns, você bateu a meta! 🎉`;
            dashSugerida.style.display = 'none';
            bar.style.width = '100%';
            bar.style.background = 'var(--accent-secondary)';
        } else {
            dashFalta.textContent = `R$ ${faltaValor.toFixed(2)}`;
            dashFalta.className = 'metric-large metric-danger';
            
            let label = 'Meta base diária';
            if (currentScope === 'week') label = 'Meta total restante da semana';
            if (currentScope === 'month') label = 'Meta total restante do mês';
            
            dashMeta.textContent = `${label}: R$ ${metaOriginal.toFixed(2)}`;
            
            if (currentScope === 'day') {
                dashSugerida.style.display = 'none';
            } else {
                dashSugerida.style.display = 'block';
                const sLabel = currentScope === 'week' ? 'semana' : 'mês';
                dashSugerida.textContent = `Para bater a meta da ${sLabel}, sugerimos: R$ ${stats.metaBrutaDiariaSugerida.toFixed(2)} / dia`;
            }
            
            const perc = (currentTotalEarned / metaOriginal) * 100;
            bar.style.width = `${perc}%`;
            bar.style.background = 'var(--accent-primary)';
        }
        dashKm.textContent = `Recomendado rodar: ${stats.kmPeriodoRestante.toFixed(0)} km`;
    }
}

document.getElementById('btn-save-day').addEventListener('click', async () => {
    const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
    let dayData = appData.history.find(h => h.date === selectedDate);
    
    if (!dayData) {
        dayData = { date: selectedDate, earnings: {}, km: 0, consumoL: 0, precoL: 0, expenses: 0 };
        appData.history.push(dayData);
    }

    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseFloat(inp.value);
        if (val) dayData.earnings[inp.dataset.plat] = val;
        else delete dayData.earnings[inp.dataset.plat];
    });

    dayData.km = parseFloat(document.getElementById('dash-km').value) || 0;
    
    const consDia = document.getElementById('dash-consumo-dia').value;
    if (consDia) dayData.consumoL = parseFloat(consDia);
    else delete dayData.consumoL;
    
    const precoDia = document.getElementById('dash-preco-litro').value;
    if (precoDia) dayData.precoL = parseFloat(precoDia);
    else delete dayData.precoL;
    
    dayData.expenses = parseFloat(document.getElementById('dash-expenses').value) || 0;

    document.getElementById('btn-save-day').textContent = "Salvando...";
    try {
        fileId = await saveData(fileId, appData);
        document.getElementById('btn-save-day').textContent = "Salvo!";
        setTimeout(() => { document.getElementById('btn-save-day').textContent = "Salvar Lançamentos"; }, 2000);
        updateDashboardTargets();
    } catch(e) {
        alert("Erro ao salvar.");
        document.getElementById('btn-save-day').textContent = "Salvar Lançamentos";
    }
});

// --- REPORTS SCREEN ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    if(!btn.classList.contains('dash-tab-btn')){
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn:not(.dash-tab-btn)').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderReports(btn.dataset.tab);
        });
    }
});

function renderReports(tabId) {
    const content = document.getElementById('report-content');
    let html = '';
    
    const history = [...appData.history].sort((a,b) => new Date(b.date) - new Date(a.date));
    
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
                        KM: ${h.km} | PreçoL: ${h.precoL ? 'R$'+h.precoL : 'Média'} | Gastos: R$ ${h.expenses}
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
    isDashboardInitialized = false; 
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
            isDashboardInitialized = false;
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
    isDashboardInitialized = false;
    showScreen('login-screen');
});
