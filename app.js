import { initAuth, login, logout } from './auth.js';
import { findDataFile, readData, saveData, deleteData } from './drive.js';
import { defaultData, calculateTargets, getDayStats } from './logic.js';

let appData = null;
let fileId = null;
let currentScope = 'day'; // day, week, month
let currentSelectedDate = new Date(); 

// Helpers de Fuso Horário e Datas
function getTodayDateString() {
    // Retorna a data no fuso de Brasilia (UTC-3), resolvendo a virada prematura
    const d = new Date();
    const str = d.toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    return str.split(',')[0];
}

function getSelectedDateString() {
    // Formata a currentSelectedDate como YYYY-MM-DD
    const yyyy = currentSelectedDate.getFullYear();
    const mm = String(currentSelectedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentSelectedDate.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Helpers de Conversão de Moeda (Máscara)
function parseCurrency(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    // Tira os pontos de milhar e troca virgula por ponto
    const clearStr = val.toString().replace(/\./g, '').replace(',', '.');
    return parseFloat(clearStr) || 0;
}

function applyCurrencyMask(e) {
    let val = e.target.value.replace(/\D/g, ''); // só numeros
    if (val === '') {
        e.target.value = '';
        updateDashboardTargets();
        return;
    }
    const num = parseInt(val, 10) / 100;
    e.target.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    updateDashboardTargets();
}

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
        alert(`Sua sessão expirou ou houve um problema de conexão. Por favor, autentique-se novamente com o Google para continuar.`);
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
let isDashboardInitialized = false;

function initDashboard() {
    if (!isDashboardInitialized) {
        
        // Define a data atual em Brasilia
        const todayParts = getTodayDateString().split('-');
        currentSelectedDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);

        // Eventos do Navegador de Datas
        document.getElementById('btn-prev-date').addEventListener('click', () => navigateDate(-1));
        document.getElementById('btn-next-date').addEventListener('click', () => navigateDate(1));
        
        // Render Platform Inputs just once per settings
        const platContainer = document.getElementById('dash-platform-inputs');
        platContainer.innerHTML = '';
        appData.settings.plataformas.forEach(p => {
            const group = document.createElement('div');
            group.className = 'input-group';
            group.innerHTML = `
                <label>Ganho ${p} (R$)</label>
                <input type="text" inputmode="numeric" class="plat-input live-calc currency-mask" data-plat="${p}" placeholder="0,00">
            `;
            platContainer.appendChild(group);
        });

        // Listeners for live calc
        document.querySelectorAll('.currency-mask').forEach(inp => {
            inp.addEventListener('input', applyCurrencyMask);
        });
        
        document.getElementById('dash-km').addEventListener('input', updateDashboardTargets);
        document.getElementById('dash-consumo-dia').addEventListener('input', updateDashboardTargets);

        // Scope Tabs
        document.querySelectorAll('.dash-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentScope = btn.dataset.scope;
                
                // Hide/Show Lançamentos
                const lancSection = document.getElementById('dash-lancamentos-section');
                if (currentScope === 'day') {
                    lancSection.style.display = 'block';
                } else {
                    lancSection.style.display = 'none';
                }
                
                updateDateDisplay();
                updateDashboardTargets();
            });
        });

        isDashboardInitialized = true;
    }
    
    updateDateDisplay();
    loadDashboardData();
}

const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const mesesAno = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function updateDateDisplay() {
    const display = document.getElementById('dash-date-display');
    const todayStr = getTodayDateString();
    const selectedStr = getSelectedDateString();
    
    if (currentScope === 'day') {
        const d = String(currentSelectedDate.getDate()).padStart(2, '0');
        const m = String(currentSelectedDate.getMonth() + 1).padStart(2, '0');
        const y = currentSelectedDate.getFullYear();
        const nomeDia = diasSemana[currentSelectedDate.getDay()];
        
        if (todayStr === selectedStr) {
            display.innerHTML = `&lt; Hoje - ${d}/${m}/${y} - ${nomeDia} &gt;`;
        } else {
            display.innerHTML = `&lt; ${d}/${m}/${y} - ${nomeDia} &gt;`;
        }
    } 
    else if (currentScope === 'week') {
        const day = currentSelectedDate.getDay(); 
        const diffToMonday = currentSelectedDate.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(currentSelectedDate);
        monday.setDate(diffToMonday);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        
        const mD = String(monday.getDate()).padStart(2, '0');
        const mM = String(monday.getMonth() + 1).padStart(2, '0');
        const mY = monday.getFullYear();
        
        const sD = String(sunday.getDate()).padStart(2, '0');
        const sM = String(sunday.getMonth() + 1).padStart(2, '0');
        const sY = sunday.getFullYear();
        
        display.innerHTML = `&lt; ${mD}/${mM}/${mY} - ${sD}/${sM}/${sY} &gt;`;
    }
    else if (currentScope === 'month') {
        const nomeMes = mesesAno[currentSelectedDate.getMonth()];
        const y = currentSelectedDate.getFullYear();
        display.innerHTML = `&lt; ${nomeMes} ${y} &gt;`;
    }
}

function navigateDate(direction) {
    if (currentScope === 'day') {
        currentSelectedDate.setDate(currentSelectedDate.getDate() + direction);
    } else if (currentScope === 'week') {
        currentSelectedDate.setDate(currentSelectedDate.getDate() + (direction * 7));
    } else if (currentScope === 'month') {
        currentSelectedDate.setMonth(currentSelectedDate.getMonth() + direction);
    }
    updateDateDisplay();
    loadDashboardData();
}

function loadDashboardData() {
    const selectedDate = getSelectedDateString();
    const dayStats = getDayStats(appData.history, selectedDate);
    
    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = dayStats.earnings[inp.dataset.plat];
        if (val) {
            inp.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        } else {
            inp.value = '';
        }
    });

    document.getElementById('dash-km').value = dayStats.km || '';
    document.getElementById('dash-consumo-dia').value = dayStats.consumoL || '';
    
    if (dayStats.precoL) {
        document.getElementById('dash-preco-litro').value = dayStats.precoL.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    } else {
        document.getElementById('dash-preco-litro').value = '';
    }
    
    if (dayStats.expenses) {
        document.getElementById('dash-expenses').value = dayStats.expenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    } else {
        document.getElementById('dash-expenses').value = '';
    }
    
    updateDashboardTargets();
}

function updateDashboardTargets() {
    const selectedDate = getSelectedDateString();
    
    const currentDayInputs = { earnings: {}, km: 0, consumoL: 0, precoL: 0, expenses: 0 };
    let currentTotalEarned = 0;
    
    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseCurrency(inp.value);
        if (val > 0) {
            currentDayInputs.earnings[inp.dataset.plat] = val;
            currentTotalEarned += val;
        }
    });
    
    currentDayInputs.km = parseFloat(document.getElementById('dash-km').value) || 0;
    currentDayInputs.consumoL = parseFloat(document.getElementById('dash-consumo-dia').value) || appData.settings.mediaConsumoL;
    
    const pL = parseCurrency(document.getElementById('dash-preco-litro').value);
    currentDayInputs.precoL = pL > 0 ? pL : appData.settings.mediaPrecoCombustivel;
    
    currentDayInputs.expenses = parseCurrency(document.getElementById('dash-expenses').value);
    
    const stats = calculateTargets(currentScope, appData.settings, appData.history, selectedDate, currentDayInputs);
    
    const dashFalta = document.getElementById('dash-falta-hoje');
    const dashMeta = document.getElementById('dash-meta-diaria-info');
    const dashSugerida = document.getElementById('dash-meta-sugerida');
    const dashKm = document.getElementById('dash-km-recomendado');
    const bar = document.getElementById('dash-progress-bar');
    
    // Atualiza subtitulos da UI
    const mediaFormatada = currentDayInputs.km > 0 && currentTotalEarned > 0 
        ? (currentTotalEarned / currentDayInputs.km).toFixed(2) 
        : '0.00';
        
    document.getElementById('dash-total-feito').textContent = `Feito: R$ ${currentTotalEarned.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    document.getElementById('dash-media-km').textContent = `Média: R$ ${mediaFormatada.replace('.', ',')}/km`;

    if (stats.error) {
        dashFalta.textContent = "Erro!";
        dashMeta.textContent = stats.error;
        dashSugerida.style.display = 'none';
        return;
    }

    if (stats.metaAlcancada) {
        dashFalta.textContent = `+ R$ ${stats.excedente.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
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
            dashFalta.textContent = `+ R$ ${Math.abs(faltaValor).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
            dashFalta.className = 'metric-large';
            dashMeta.textContent = `Parabéns, você bateu a meta! 🎉`;
            dashSugerida.style.display = 'none';
            bar.style.width = '100%';
            bar.style.background = 'var(--accent-secondary)';
        } else {
            dashFalta.textContent = `R$ ${faltaValor.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
            dashFalta.className = 'metric-large metric-danger';
            
            let label = 'Meta base diária';
            if (currentScope === 'week') label = 'Meta total restante da semana';
            if (currentScope === 'month') label = 'Meta total restante do mês';
            
            dashMeta.textContent = `${label}: R$ ${metaOriginal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
            
            if (currentScope === 'day') {
                dashSugerida.style.display = 'none';
            } else {
                dashSugerida.style.display = 'block';
                const sLabel = currentScope === 'week' ? 'semana' : 'mês';
                dashSugerida.textContent = `Para bater a meta da ${sLabel}, sugerimos: R$ ${stats.metaBrutaDiariaSugerida.toLocaleString('pt-BR', {minimumFractionDigits:2})} / dia`;
            }
            
            const perc = (currentTotalEarned / metaOriginal) * 100;
            bar.style.width = `${perc}%`;
            bar.style.background = 'var(--accent-primary)';
        }
        dashKm.textContent = `Recomendado rodar: ${stats.kmPeriodoRestante.toFixed(0)} km`;
    }
}

document.getElementById('btn-save-day').addEventListener('click', async () => {
    const selectedDate = getSelectedDateString();
    let dayData = appData.history.find(h => h.date === selectedDate);
    
    if (!dayData) {
        dayData = { date: selectedDate, earnings: {}, km: 0, consumoL: 0, precoL: 0, expenses: 0 };
        appData.history.push(dayData);
    }

    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseCurrency(inp.value);
        if (val > 0) dayData.earnings[inp.dataset.plat] = val;
        else delete dayData.earnings[inp.dataset.plat];
    });

    dayData.km = parseFloat(document.getElementById('dash-km').value) || 0;
    
    const consDia = document.getElementById('dash-consumo-dia').value;
    if (consDia) dayData.consumoL = parseFloat(consDia);
    else delete dayData.consumoL;
    
    const precoDia = parseCurrency(document.getElementById('dash-preco-litro').value);
    if (precoDia > 0) dayData.precoL = precoDia;
    else delete dayData.precoL;
    
    dayData.expenses = parseCurrency(document.getElementById('dash-expenses').value) || 0;

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
                        <span style="color:var(--accent-secondary)">R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        KM: ${h.km} | PreçoL: ${h.precoL ? 'R$'+h.precoL.toLocaleString('pt-BR') : 'Média'} | Gastos: R$ ${h.expenses ? h.expenses.toLocaleString('pt-BR') : '0'}
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
